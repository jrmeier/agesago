import { chromium } from '@playwright/test';
import { appendFileSync } from 'node:fs';
const browser = await chromium.launch({channel:'chrome',headless:false,args:['--mute-audio','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding']});
try {
 for (const size of ['small','medium','large','giant']) for (const type of ['mediterranean','highlands','riverValley','forest','islands']) {
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  const page=await context.newPage();
  await page.goto(`${process.env.MAP_RENDER_BASE_URL ?? 'http://localhost:4174'}/?e2e&title=1&debug=1&quality=low`);
  await page.locator('#title-new').click();
  await page.locator('#title-map-size').selectOption(size);
  await page.locator('#title-map-type').selectOption(type);
  await page.locator('#title-start').click();
  await page.waitForFunction(()=>window.game?.world && document.querySelector('#perf-overlay pre')?.textContent.includes('FPS'), {timeout:60000});
  await page.waitForTimeout(2000);
  const row=await page.evaluate(async()=>{
   const game=window.game, times=[]; let last=performance.now();
   await new Promise(resolve=>{const frame=now=>{times.push(now-last);last=now;if(times.length===180)resolve();else requestAnimationFrame(frame)};requestAnimationFrame(frame)});
   times.shift();const sorted=[...times].sort((a,b)=>a-b);const mean=times.reduce((a,b)=>a+b,0)/times.length;
   const gl=game.renderer.webgl.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
   return {map:game.world.mapOptions,quality:game.quality.tier,boot:game.boot,fps:1000/mean,medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.floor(sorted.length*.95)],renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable',triangles:game.renderer.webgl.info.render.triangles,draws:game.renderer.webgl.info.render.calls};
  });
  appendFileSync(process.env.MAP_RENDER_OUTPUT ?? '/tmp/agesago-map-render-native.jsonl',JSON.stringify(row)+'\n');console.log(JSON.stringify(row));await context.close();
 }
} finally {await browser.close()}
