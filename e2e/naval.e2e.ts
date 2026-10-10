import { expect, test } from '@playwright/test';

test('Islands: build a dock, fish, trade and unload a transport through desktop and phone controls', async ({ page }, info) => {
  test.setTimeout(180_000);
  const phone=info.project.name==='phone'; const activate=async(selector:string)=>{ if(phone) await page.locator(selector).tap(); else await page.locator(selector).click(); };
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?e2e&title&quality=low'); await page.waitForFunction(()=>document.getElementById('title-screen')?.dataset.resume==='no',undefined,{timeout:15_000});
  await activate('#title-new'); await page.locator('#title-seed').fill('9'); await page.locator('#title-map-size').selectOption('small'); await page.locator('#title-map-type').selectOption('islands');
  await activate('#title-start');
  await page.waitForFunction(()=>(window as any).game?.renderer?.webgl?.info?.render?.frame>2,undefined,{timeout:30_000});
  const map=await page.evaluate(()=>document.documentElement.dataset.mapType);
  expect(map).toBe('islands');
  const first=await page.evaluate(()=> {
    const w=window as any; const g=w.game, world=g.world;
    w.dev.give({wood:3000,stone:1000,gold:1000,food:2000}); w.dev.setAge(1);
    world.visibility.state.fill(2); world.visibility.version++;
    for(let i=0;i<3;i++)w.dev.placeComplete('house');
    const dock=w.dev.placeComplete('dock'); if(!dock) return null;
    const b=world.buildings.get(dock); g.selection.set([dock]); g.rig.focusOn(b.pos); return dock;
  });
  expect(first).not.toBeNull();
  if(phone) await activate('#menu-tabs [data-menu="train"]');
  for(const kind of ['fishingBoat','merchantShip','transport']) {
    const button=page.locator(`#train-grid [data-train="${kind}"]`); await expect(button).toBeVisible();
    if(phone)await button.tap();else await button.click();
  }
  await page.evaluate(()=>(window as any).dev.fastForward(80));
  const setup=await page.evaluate((first)=> {
    const g=(window as any).game, w=g.world, dock=w.buildings.get(first);
    const boat=[...w.units.values()].find((u:any)=>u.kind==='fishingBoat') as any;
    const merchant=[...w.units.values()].find((u:any)=>u.kind==='merchantShip') as any;
    const transport=[...w.units.values()].find((u:any)=>u.kind==='transport') as any;
    const fish=[...w.nodes.values()].filter((n:any)=>n.kind==='fish'&&w.waterNav.connected(w.waterNav.nearestFree(boat.pos),w.waterNav.nearestFree(n.pos)))
      .sort((a:any,b:any)=>Math.hypot(a.pos.x-boat.pos.x,a.pos.z-boat.pos.z)-Math.hypot(b.pos.x-boat.pos.x,b.pos.z-boat.pos.z))[0] as any;
    if(!fish||!transport||!merchant)throw new Error('Missing ships or reachable fish '+JSON.stringify({fish:!!fish,transport:!!transport,merchant:!!merchant,boats:[...w.units.values()].map((u:any)=>u.kind)}));
    w.visibility.state.fill(2); w.visibility.version++;
    w.dispatch({type:'gather',unitIds:[boat.id],nodeId:fish.id}); const food=w.stock.food;
    (window as any).dev.fastForward(100); w.visibility.state.fill(2); w.visibility.version++;
    // The second dock is genuinely placed at another reachable coast, with the real build command.
    let second:any=null;
    for(let z=4;z<w.hf.depth-4&&!second;z+=2)for(let x=4;x<w.hf.width-4&&!second;x+=2){
      const p={x,z}; if(Math.hypot(x-dock.pos.x,z-dock.pos.z)<18||!w.canPlace('dock',p,0).ok)continue;
      const sea=w.waterNav.nearestFree(p); if(!sea||!w.waterNav.connected(w.waterNav.nearestFree(merchant.pos),sea))continue;
      const vill=[...w.units.values()].filter((u:any)=>u.kind==='villager'&&u.owner===w.localPlayer).map((u:any)=>u.id);
      w.dispatch({type:'build',unitIds:vill,kind:'dock',pos:p,rot:0});
      second=[...w.buildings.values()].find((b:any)=>b.kind==='dock'&&b.id!==first) as any;
      if(second){second.complete=true;second.buildProgress=1;second.hp=second.maxHp;w.events.emit({type:'constructed',id:second.id});}
    }
    if(!second)throw new Error('No second reachable dock');
    const gold=w.stock.gold; w.dispatch({type:'navalTrade',unitIds:[merchant.id],dockId:second.id}); (window as any).dev.fastForward(150);
    // Prepare a real boarding order on a shore next to this dock. Passenger movement still uses land paths.
    let shore:any=null, sea:any=null;
    for(let z=4;z<w.hf.depth-4&&!shore;z+=1)for(let x=4;x<w.hf.width-4&&!shore;x+=1){
      const p={x,z}; if(!w.nav.isFree(p))continue;
      const q=w.waterNav.nearestFree(p); if(q&&Math.hypot(q.x-x,q.z-z)<1.5&&w.waterNav.connected(w.waterNav.nearestFree(transport.pos),q)){shore=p;sea=q;}
    }
    if(!shore)throw new Error('No transport boarding shore');
    transport.pos={...sea};transport.prevPos={...sea};transport.path=[];
    const p=w.spawnUnit('villager',shore); w.dispatch({type:'loadTransport',unitIds:[p.id],transportId:transport.id}); (window as any).dev.fastForward(1);
    g.selection.set([transport.id]);g.rig.focusOn(shore);
    return {foodGain:w.stock.food-food,goldGain:w.stock.gold-gold,transport:transport.id,passenger:p.id,shore,sea};
  },first);
  expect(setup).not.toBeNull(); expect(setup!.foodGain).toBeGreaterThan(15); expect(setup!.goldGain).toBeGreaterThan(0);
  if(phone) await activate('#menu-tabs [data-menu="orders"]');
  await activate('#command-card [data-cmd="unloadTransport"]'); await expect(page.locator('body')).toHaveClass(/targeting/);
  const point=await page.evaluate(({shore})=> {
    const g=(window as any).game,c=g.renderer.domElement,r=c.getBoundingClientRect(),v=g.rig.camera.position.clone();g.rig.camera.updateMatrixWorld(true);
    v.set(shore.x,Math.max(0,g.world.hf.heightAt(shore.x,shore.z)),shore.z).project(g.rig.camera);
    return{x:r.left+(v.x+1)/2*r.width,y:r.top+(1-v.y)/2*r.height};
  },setup!);
  if(phone) { await page.touchscreen.tap(point.x,point.y); await page.touchscreen.tap(point.x,point.y); } else await page.mouse.click(point.x,point.y);
  await page.waitForFunction(({transport,passenger})=>{const w=(window as any).game.world;return w.landings.has(transport)||w.units.get(passenger).state==='idle';},setup!,{timeout:10_000});
  await page.evaluate(()=>(window as any).dev.fastForward(3));
  expect(await page.evaluate(({passenger})=>(window as any).game.world.units.get(passenger).state,setup!)).toBe('idle');
  expect(errors).toEqual([]);
});
