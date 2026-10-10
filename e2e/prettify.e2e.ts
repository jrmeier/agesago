import { expect, test, type Page } from '@playwright/test';

/** Layout regressions from the visual refresh: overlap, overflow, reach and touch target size. */

/** Load the game with the test hook and collect page errors. */
async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/?e2e');
  await page.waitForFunction(() => (window as any).game?.renderer?.webgl?.info?.render?.frame > 2, null, { timeout: 30_000 });
  await page.locator('#loading').waitFor({ state: 'detached' });
  return errors;
}

/** Select one local villager and wait for the panel to show its build choices. */
async function selectVillager(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = (window as any).game;
    const one = [...g.world.units.values()].find((u: any) => u.owner === g.world.localPlayer && u.kind === 'villager');
    g.selection.set([one.id]);
  });
  await expect(page.locator('#selection-panel')).not.toHaveClass(/\bhidden\b/);
  await expect.poll(async () => page.locator('#build-grid button').count()).toBeGreaterThan(0);
}

/** Check painted text, not only container scrollWidth (ellipsis can conceal clipping). */
async function resourceTextProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const g = (window as any).game;
    Object.assign(g.world.stock, { food: 9999, wood: 9999, gold: 9999, stone: 9999 });
    g.world.events.emit({ type: 'stockpile', stock: g.world.stock, pop: 199, popCap: 200 });
    const problems: string[] = [];
    for (const el of document.querySelectorAll('.res > span[id^="res-"]')) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const text = range.getBoundingClientRect();
      for (let a: Element | null = el; a && a !== document.documentElement; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (a !== el && s.overflowX === 'visible' && s.overflowY === 'visible') continue;
        const box = a.getBoundingClientRect();
        if (text.left < box.left - 1 || text.right > box.right + 1 || text.top < box.top - 1 || text.bottom > box.bottom + 1) {
          problems.push(`${el.id}: ${el.textContent} is clipped by ${a.id || a.className}`);
        }
      }
    }
    return problems;
  });
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Control {
  id: string;
  /** Border box, measured once the control has been scrolled into its sheet if it needed it. */
  rect: Box;
  /** The whole rect is on screen and not clipped by an overflow ancestor. */
  whole: boolean;
  /** Index of the user-scrollable ancestor it sits in, or -1. */
  scroller: number;
  inMinimap: boolean;
  disabled: boolean;
  /** elementFromPoint at the centre lands on the control. */
  onTop: boolean;
}

interface Layout {
  vw: number;
  vh: number;
  overflowX: number;
  minimap: Box | null;
  panel: Box | null;
  controls: Control[];
}

/**
 * Geometry of every rendered <button> under `root` (default: the HUD, minimap and dialogs).
 * Buttons under a hidden ancestor are skipped. A button clipped by a box the user can scroll
 * (overflow auto/scroll with content to scroll) is scrolled into that box first; one clipped
 * by anything else, including overflow: hidden, stays clipped and so is not `whole`.
 */
async function measure(page: Page, root = '#app'): Promise<Layout> {
  // Let finite transitions (panel slide-ins, sheet opening) land and the HUD repaint.
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    const done = Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
    await Promise.race([done, new Promise((r) => setTimeout(r, 2000))]);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  return page.evaluate((rootSel) => {
    type B = { x: number; y: number; w: number; h: number };
    const box = (r: DOMRect): B => ({ x: r.left, y: r.top, w: r.width, h: r.height });
    const rendered = (el: Element) => {
      const r = el.getBoundingClientRect();
      return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && r.width > 0 && r.height > 0;
    };
    /** The rect lies within the viewport and every clipping ancestor (1 px slack). */
    const unclipped = (el: Element) => {
      const r = box(el.getBoundingClientRect());
      const within = (c: B) => r.x >= c.x - 1 && r.y >= c.y - 1 && r.x + r.w <= c.x + c.w + 1 && r.y + r.h <= c.y + c.h + 1;
      if (!within({ x: 0, y: 0, w: innerWidth, h: innerHeight })) return false;
      for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
        const s = getComputedStyle(a);
        if ((s.overflowX !== 'visible' || s.overflowY !== 'visible') && !within(box(a.getBoundingClientRect()))) return false;
      }
      return true;
    };
    const scrollers: Element[] = [];
    const scrollerOf = (el: Element) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        const y = /auto|scroll/.test(s.overflowY) && a.scrollHeight > a.clientHeight;
        const x = /auto|scroll/.test(s.overflowX) && a.scrollWidth > a.clientWidth;
        if (x || y) return a;
      }
      return null;
    };
    /** Scroll only `scroller` (not the page) until `el` sits inside its client area. */
    const reveal = (el: Element, scroller: Element) => {
      const r = el.getBoundingClientRect();
      const c = scroller.getBoundingClientRect();
      const top = c.top + scroller.clientTop;
      const left = c.left + scroller.clientLeft;
      if (r.top < top) scroller.scrollTop -= top - r.top;
      else if (r.bottom > top + scroller.clientHeight) scroller.scrollTop += r.bottom - top - scroller.clientHeight;
      if (r.left < left) scroller.scrollLeft -= left - r.left;
      else if (r.right > left + scroller.clientWidth) scroller.scrollLeft += r.right - left - scroller.clientWidth;
    };
    const label = (el: Element) =>
      el.id || el.getAttribute('data-menu') || el.getAttribute('data-cmd') || el.getAttribute('data-stance') || el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 24) || el.className;

    const minimapEl = document.querySelector('.minimap');
    const panelEl = document.getElementById('selection-panel');
    const controls = [...document.querySelectorAll(`${rootSel} button`)].filter(rendered).map((el) => {
      const scroller = scrollerOf(el);
      if (scroller && !unclipped(el)) reveal(el, scroller);
      if (scroller && !scrollers.includes(scroller)) scrollers.push(scroller);
      const rect = box(el.getBoundingClientRect());
      const hit = document.elementFromPoint(rect.x + rect.w / 2, rect.y + rect.h / 2);
      return {
        id: String(label(el)),
        rect,
        whole: unclipped(el),
        scroller: scroller ? scrollers.indexOf(scroller) : -1,
        inMinimap: !!minimapEl?.contains(el),
        disabled: (el as HTMLButtonElement).disabled,
        onTop: !!hit && (hit === el || el.contains(hit)),
      };
    });
    return {
      vw: innerWidth,
      vh: innerHeight,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      minimap: minimapEl && rendered(minimapEl) ? box(minimapEl.getBoundingClientRect()) : null,
      panel: panelEl && rendered(panelEl) ? box(panelEl.getBoundingClientRect()) : null,
      controls,
    };
  }, root);
}

const EPS = 1;
const inside = (b: Box, l: Layout) => b.x >= -EPS && b.y >= -EPS && b.x + b.w <= l.vw + EPS && b.y + b.h <= l.vh + EPS;
const overlaps = (a: Box, b: Box) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > EPS && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > EPS;

/**
 * The shared outcome checks: no sideways scroll, panel on screen, every rendered control whole
 * on screen (after scrolling its sheet), none under the minimap or another control, and the
 * enabled ones on top at their centre. Disabled controls still count for overlap.
 */
function expectUsable(l: Layout, where: string): void {
  expect(l.overflowX, `${where}: horizontal overflow`).toBeLessThanOrEqual(0);
  if (l.panel) expect(inside(l.panel, l), `${where}: selection panel ${JSON.stringify(l.panel)} leaves the viewport`).toBe(true);
  const resign = l.controls.find((c) => c.id === 'resign-btn');
  if (l.panel && resign) expect(overlaps(l.panel, resign.rect), `${where}: Resign covers the selection panel`).toBe(false);
  for (const c of l.controls) {
    expect(c.whole, `${where}: ${c.id} ${JSON.stringify(c.rect)} is clipped or off screen`).toBe(true);
    if (!c.disabled) expect(c.onTop, `${where}: ${c.id} is covered at its centre`).toBe(true);
  }
  const actions = l.controls.filter((c) => !c.inMinimap);
  if (l.minimap) {
    for (const c of actions) expect(overlaps(c.rect, l.minimap), `${where}: minimap covers ${c.id}`).toBe(false);
  }
  for (let i = 0; i < actions.length; i++) {
    for (let j = i + 1; j < actions.length; j++) {
      const [a, b] = [actions[i], actions[j]];
      // Two items of one scrolled sheet were measured at different scroll offsets.
      if (a.scroller >= 0 && a.scroller === b.scroller) continue;
      expect(overlaps(a.rect, b.rect), `${where}: ${a.id} overlaps ${b.id}`).toBe(false);
    }
  }
}

function expectTouchTargets(controls: Control[], where: string): void {
  expect(controls.length, `${where}: no controls`).toBeGreaterThan(0);
  for (const c of controls) {
    expect(c.rect.w >= 44 && c.rect.h >= 44, `${where}: ${c.id} is ${c.rect.w}x${c.rect.h}`).toBe(true);
  }
}

/**
 * Every Build button's `.build-name` is rendered, non-empty and wholly inside its button. Measured
 * relative to the button, so it holds at any scroll offset of the sheet. Returns the failures.
 */
async function buildNameProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const buttons = [...document.querySelectorAll('#build-grid button')];
    if (!buttons.length) problems.push('no build buttons');
    for (const [i, button] of buttons.entries()) {
      const name = button.querySelector('.build-name');
      const id = `build button ${i}`;
      if (!name) {
        problems.push(`${id}: no .build-name`);
        continue;
      }
      for (let a: Element | null = name; a && a !== document.documentElement; a = a.parentElement) {
        if (getComputedStyle(a).display === 'none') problems.push(`${id}: ${a.tagName}.${a.className} is display: none`);
      }
      if (!name.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) problems.push(`${id}: .build-name is not visible`);
      if (!name.textContent?.trim()) problems.push(`${id}: .build-name is empty`);
      const b = button.getBoundingClientRect();
      const n = name.getBoundingClientRect();
      if (n.width <= 0 || n.height <= 0) problems.push(`${id}: .build-name has no size`);
      if (n.left < b.left - 1 || n.top < b.top - 1 || n.right > b.right + 1 || n.bottom > b.bottom + 1) {
        problems.push(`${id}: .build-name ${JSON.stringify(n)} leaves button ${JSON.stringify(b)}`);
      }
    }
    return problems;
  });
}

test('desktop HUD leaves actions clear of the minimap, unselected and with a villager', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'desktop layout');
  const errors = await boot(page);
  expect(page.viewportSize()).toEqual({ width: 1280, height: 800 });
  expect(await resourceTextProblems(page), 'desktop large resource counts').toEqual([]);

  const idle = await measure(page);
  expect(idle.minimap).not.toBeNull();
  expectUsable(idle, 'unselected');

  await selectVillager(page);
  const selected = await measure(page);
  expect(selected.panel).not.toBeNull();
  expect(selected.controls.length).toBeGreaterThan(idle.controls.length);
  expectUsable(selected, 'selected villager');

  // Every build choice, affordable or not, is a rendered, reachable button.
  const builds = await page.locator('#build-grid button').count();
  const shownBuilds = (await measure(page, '#build-grid')).controls.length;
  expect(shownBuilds).toBe(builds);

  // Intermediate desktop width: the adaptive layout still fits with the villager selected.
  await page.setViewportSize({ width: 900, height: 800 });
  const mid = await measure(page);
  expect(mid.panel).not.toBeNull();
  expectUsable(mid, '900 selected villager');
  expect((await measure(page, '#build-grid')).controls.length).toBe(await page.locator('#build-grid button').count());
  expect(errors).toEqual([]);
});

test('narrow phone sheets keep 44 px targets inside the screen and off the minimap', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout');
  await page.setViewportSize({ width: 360, height: 800 });
  const errors = await boot(page);
  await expect(page.locator('body')).toHaveClass(/touch/);
  for (const width of [360, 390, 430]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await resourceTextProblems(page), `${width} large resource counts`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 360, height: 800 });

  const idle = await measure(page);
  expectUsable(idle, '360 unselected');
  expectTouchTargets((await measure(page, '.touch-bar')).controls, '360 touch bar');

  await selectVillager(page);
  await expect(page.locator('#menu-tabs')).toBeVisible();
  const summary = await measure(page);
  expectUsable(summary, '360 selected');
  expectTouchTargets((await measure(page, '#menu-tabs')).controls, '360 menu tabs');

  await page.locator('#menu-tabs [data-menu="build"]').tap();
  await expect(page.locator('body')).toHaveClass(/menu-build/);
  await expect(page.locator('#build-grid')).toBeVisible();
  const build = await measure(page);
  expectUsable(build, '360 build sheet');
  const buildButtons = (await measure(page, '#build-grid')).controls;
  expect(buildButtons.length).toBe(await page.locator('#build-grid button').count());
  expectTouchTargets(buildButtons, '360 build sheet');
  expect(await buildNameProblems(page), '360 build names').toEqual([]);

  await page.locator('#menu-tabs [data-menu="orders"]').tap();
  await expect(page.locator('body')).toHaveClass(/menu-orders/);
  await expect(page.locator('#command-card')).toBeVisible();
  const orders = await measure(page);
  expectUsable(orders, '360 orders sheet');
  expectTouchTargets((await measure(page, '#command-card')).controls, '360 orders sheet');
  expect(errors).toEqual([]);
});

test('short landscape sheets leave actions clear of the minimap with 44 px targets', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'touch landscape layout');
  await page.setViewportSize({ width: 844, height: 390 });
  const errors = await boot(page);
  expect(await resourceTextProblems(page), 'landscape large resource counts').toEqual([]);
  // Filled groups must remain reachable when the short rail needs scrolling.
  await page.evaluate(() => {
    const g = (window as any).game;
    const units = [...g.world.units.values()].filter((u: any) => u.owner === g.world.localPlayer);
    units.slice(0, 4).forEach((u: any, i) => g.controls.groups.assign(i + 1, [u.id]));
  });
  await expect(page.locator('#group-bar .group-btn:not(.empty)')).toHaveCount(4);
  expectUsable(await measure(page), 'landscape unselected');
  await selectVillager(page);
  expectUsable(await measure(page), 'landscape selected');
  for (const menu of ['build', 'orders']) {
    await page.locator(`#menu-tabs [data-menu="${menu}"]`).tap();
    expectUsable(await measure(page), `landscape ${menu}`);
    expectTouchTargets((await measure(page, '.touch-bar')).controls, `landscape ${menu} toolbar`);
    expectTouchTargets((await measure(page, '.side-rail')).controls, `landscape ${menu} rail`);
  }
  expectTouchTargets((await measure(page, '#command-card')).controls, 'landscape orders');
  expect(errors).toEqual([]);
});

test('first person on a phone hides the map and box tools and keeps View reachable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout');
  await page.setViewportSize({ width: 360, height: 800 });
  const errors = await boot(page);
  await page.locator('#touch-fps').tap();
  await expect(page.locator('body')).toHaveClass(/fps-mode/);
  await expect(page.locator('#touch-fps')).toHaveAttribute('aria-pressed', 'true');
  for (const id of ['#touch-box', '#touch-select-all', '#touch-deselect']) await expect(page.locator(id)).toBeHidden();

  const fps = await measure(page);
  expect(fps.minimap).toBeNull();
  expectUsable(fps, '360 first person');
  expectTouchTargets((await measure(page, '.touch-bar')).controls, '360 first-person touch bar');
  expect(errors).toEqual([]);
});

test('the hotkey sheet fits the viewport and its close button is reachable', async ({ page }, testInfo) => {
  const phone = testInfo.project.name === 'phone';
  if (phone) await page.setViewportSize({ width: 360, height: 800 });
  const errors = await boot(page);
  if (phone) await page.locator('#help-btn').tap();
  else await page.locator('#help-btn').click();
  await expect(page.locator('#hotkey-help')).toBeVisible();

  const sheet = await page.locator('.hotkey-sheet').boundingBox();
  const vp = page.viewportSize()!;
  expect(sheet).toBeTruthy();
  expect(sheet!.x >= -EPS && sheet!.y >= -EPS && sheet!.x + sheet!.width <= vp.width + EPS && sheet!.y + sheet!.height <= vp.height + EPS).toBe(true);

  // The modal covers the HUD, minimap included; only its own controls matter here.
  const help = { ...(await measure(page, '#hotkey-help')), minimap: null, panel: null };
  expectUsable(help, 'hotkey sheet');
  const close = help.controls.find((c) => c.id === 'hotkey-close');
  expect(close).toBeTruthy();
  if (phone) expectTouchTargets([close!], 'hotkey close');
  expect(errors).toEqual([]);
});
