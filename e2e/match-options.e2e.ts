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
