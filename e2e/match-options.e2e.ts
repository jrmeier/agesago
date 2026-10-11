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
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1);expect(overflow).toBe(false);
  await activate('#title-start');
  await page.waitForFunction(()=>document.documentElement.dataset.mapSize==='small'&&document.documentElement.dataset.civ==='persians'&&document.documentElement.dataset.mapType==='islands');
  await expect(page.locator('canvas').first()).toBeVisible();
  await activate('#save-copy');await expect(page.locator('#save-note')).toHaveText('Saved');
  await page.goto('/');await page.waitForFunction(()=>document.getElementById('title-screen')?.dataset.resume==='yes');await activate('#title-continue');
  await page.waitForFunction(()=>document.documentElement.dataset.mapSize==='small'&&document.documentElement.dataset.civ==='persians'&&document.documentElement.dataset.mapType==='islands');
  expect(errors).toEqual([]);
});
