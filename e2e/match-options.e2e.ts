import { test, expect } from '@playwright/test';

test('civilization and map controls launch and resume a small island match on desktop and phone',async({page},info)=> {
  test.setTimeout(120000);
  const activate=async(selector:string)=>{if(info.project.name==='phone')await page.locator(selector).tap();else await page.locator(selector).click();};
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.waitForFunction(()=>document.getElementById('title-screen')?.dataset.resume==='no');
  await activate('#title-new');
  await page.locator('#title-civ').selectOption('persians');
  await expect(page.locator('#title-civ-bonus')).toContainText('Immortals');
  await page.locator('#title-map-size').selectOption('small');await page.locator('#title-map-type').selectOption('islands');
  // Wonder victory: on with a 5 minute timer by default; turning it off disables the timer.
  await expect(page.locator('#title-wonder')).toBeChecked();
  await expect(page.locator('#title-wonder-timer')).toHaveValue('300');
  await activate('#title-wonder');await expect(page.locator('#title-wonder')).not.toBeChecked();await expect(page.locator('#title-wonder-timer')).toBeDisabled();
  await activate('#title-wonder');await expect(page.locator('#title-wonder-timer')).toBeEnabled();
  await page.locator('#title-wonder-timer').selectOption('600');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1);expect(overflow).toBe(false);
  await activate('#title-start');
  await page.waitForFunction(()=>document.documentElement.dataset.mapSize==='small'&&document.documentElement.dataset.civ==='persians'&&document.documentElement.dataset.mapType==='islands');
  await expect(page.locator('canvas').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.dataset.wonder)).toBe('600');
  await expect(page.locator('#wonder-timer')).toBeHidden();
  if(info.project.name==='phone')await activate('#pause-match');
  await activate('#save-copy');await expect(page.locator('#save-note')).toHaveText('Saved');
  await page.goto('/');await page.waitForFunction(()=>document.getElementById('title-screen')?.dataset.resume==='yes');await activate('#title-continue');
  await page.waitForFunction(()=>document.documentElement.dataset.mapSize==='small'&&document.documentElement.dataset.civ==='persians'&&document.documentElement.dataset.mapType==='islands');
  expect(await page.evaluate(()=>document.documentElement.dataset.wonder)).toBe('600');
  expect(errors).toEqual([]);
});

test('the wonder toggle reaches the match, and a finished wonder shows its countdown in the top bar',async({page},info)=> {
  test.setTimeout(120000);
  const activate=async(selector:string)=>{if(info.project.name==='phone')await page.locator(selector).tap();else await page.locator(selector).click();};
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?e2e&title');await page.waitForFunction(()=>document.getElementById('title-screen')?.dataset.resume!=null);
  await activate('#title-new');
  if(await page.locator('#title-discard-yes').isVisible())await activate('#title-discard-yes');
  await page.locator('#title-map-size').selectOption('small');
  await activate('#title-wonder');
  await activate('#title-start');
  await page.waitForFunction(()=>document.documentElement.dataset.wonder==='off');
  const rules=await page.evaluate(()=>(window as unknown as {game:{world:{wonderRules:unknown}}}).game.world.wonderRules);
  expect(rules).toEqual({enabled:false,seconds:300});
  // Turn the option on in place and raise a finished wonder: the top bar counts down in the owner's colour.
  const id=await page.evaluate(()=>{
    type W={wonderRules:{enabled:boolean;seconds:number}};
    type D={give(s:Record<string,number>):void;setAge(a:number):void;placeComplete(k:string):number|null};
    const win=window as unknown as {game:{world:W};dev:D};
    win.game.world.wonderRules={enabled:true,seconds:120};
    win.dev.setAge(3);win.dev.give({food:1000,wood:1000,gold:1000,stone:1000});
    return win.dev.placeComplete('wonder');
  });
  expect(id).not.toBeNull();
  await expect(page.locator('#wonder-timer')).toBeVisible();
  await expect(page.locator('#wonder-time')).toHaveText(/^(2:00|1:59)$/);
  expect(await page.locator('#wonder-timer').evaluate(el=>getComputedStyle(el).borderColor)).not.toBe('');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1);expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

test('difficulty, teams and resources reach the sim and survive Continue', async ({ page }, info) => {
  test.setTimeout(120_000);
  const phone = info.project.name === 'phone';
  if (phone) await page.setViewportSize({ width: 360, height: 640 });
  const activate = async (selector: string) => {
    if (phone) await page.locator(selector).tap();
    else await page.locator(selector).click();
  };
  await page.goto('/?e2e&title&seed=12');
  await page.waitForFunction(() => document.getElementById('title-screen')?.dataset.resume === 'no');
  await activate('#title-new');
  await expect(page.locator('#title-seed')).toHaveValue('12');
  await expect(page.locator('#title-difficulty')).toHaveValue('moderate');
  await expect(page.locator('#title-resources')).toHaveValue('standard');
  await activate('[data-players="1"]');
  await expect(page.locator('#title-difficulty')).toBeDisabled();
  await expect(page.locator('#title-teams option[value="allied-rivals"]')).toBeDisabled();
  await expect(page.locator('#title-teams option[value="pairs"]')).toBeDisabled();
  await activate('[data-players="4"]');
  await page.locator('#title-teams').selectOption('pairs');
  await activate('[data-players="3"]');
  await expect(page.locator('#title-teams')).toHaveValue('ffa');
  await expect(page.locator('#title-teams option[value="pairs"]')).toBeDisabled();
  await page.locator('#title-teams').selectOption('allied-rivals');
  await activate('[data-players="2"]');
  await expect(page.locator('#title-teams')).toHaveValue('ffa');
  await activate('[data-players="3"]');
  await expect(page.locator('#title-difficulty')).toBeEnabled();
  await page.locator('#title-difficulty').selectOption('hard');
  await page.locator('#title-teams').selectOption('allied-rivals');
  await page.locator('#title-resources').selectOption('high');
  await page.locator('#title-map-size').selectOption('small');
  for (const selector of ['#title-difficulty', '#title-teams', '#title-resources']) {
    const select = page.locator(selector);
    await select.scrollIntoViewIfNeeded();
    await expect(select).toBeInViewport();
    const box = await select.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual((await page.viewportSize())!.width);
  }
  expect(await page.locator('#title-setup').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await activate('#title-start');
  await page.waitForFunction(() => (window as any).game?.world);
  expect(await page.evaluate(() => ({ ...document.documentElement.dataset }))).toMatchObject({
    seed: '12', players: '3', difficulty: 'hard', teams: 'allied-rivals', resources: 'high',
  });
  await expect(page.locator('#res-food')).toHaveText('600');
  const inspect = () => page.evaluate(() => {
    const game = (window as any).game;
    return {
      players: [...game.world.players.values()].map((s: any) => ({ difficulty: s.player.difficulty ?? null, team: s.player.team })),
      enemies: game.world.areEnemies(2, 3),
      profiles: game.ais.map((ai: any) => ({ targetVillagers: ai.profile.targetVillagers, reaction: ai.profile.reaction })),
    };
  });
  const expected = {
    players: [{ difficulty: null, team: 1 }, { difficulty: 'hard', team: 2 }, { difficulty: 'hard', team: 2 }],
    enemies: false,
    // Actual Game-created hard profiles, rather than just the requested label.
    profiles: [{ targetVillagers: 48, reaction: 2.5 }, { targetVillagers: 48, reaction: 2.5 }],
  };
  expect(await inspect()).toEqual(expected);
  if (phone) await activate('#pause-match');
  await activate('#save-copy');
  await expect(page.locator('#save-note')).toHaveText('Saved');
  await page.goto('/?e2e&title');
  await page.waitForFunction(() => document.getElementById('title-screen')?.dataset.resume === 'yes');
  await activate('#title-continue');
  await page.waitForFunction(() => (window as any).game?.world);
  expect(await inspect()).toEqual(expected);
  expect(await page.evaluate(() => document.documentElement.dataset.difficulty)).toBe('hard');
  expect(await page.evaluate(() => document.documentElement.dataset.teams)).toBe('allied-rivals');
  await page.evaluate(() => (window as any).game.world.dispatch({ type: 'resign' }, 1));
  await expect(page.locator('#endgame-winners')).toHaveText('Winners: Rival 1, Rival 2');
});
