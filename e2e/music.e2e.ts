import { expect, test, type Page } from '@playwright/test';

async function observeAudio(page: Page, lockUntilGesture = false): Promise<void> {
  await page.addInitScript(lock => {
    // Playwright evaluates with userGesture:true. Keep its inspection calls from
    // unlocking this one test's music before an actual pointer/key input arrives.
    if (lock) {
      let activated = false;
      window.addEventListener('pointerdown', () => { activated = true; }, { capture: true });
      window.addEventListener('keydown', () => { activated = true; }, { capture: true });
      Object.defineProperty(navigator, 'userActivation', { value: { get hasBeenActive() { return activated; } } });
    }
    const probe = { media: [] as HTMLMediaElement[], gains: [] as GainNode[], slots: [] as any[], analysers: [] as AnalyserNode[], curves: [] as any[], playErrors: [] as string[], decodeCalls: 0, ctx: null as AudioContext | null };
    (window as any).__audioProbe = probe;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { return play.call(this).catch(error => { probe.playErrors.push(error.name + ': ' + error.message); throw error; }); };
    const proto = AudioContext.prototype;
    const gain = proto.createGain;
    proto.createGain = function () {
      const node = gain.call(this), connect = node.connect;
      (node as any).connect = function (dest: AudioNode) { (node as any).dest = dest; return connect.call(node, dest); };
      probe.gains.push(node); probe.ctx = this; return node;
    };
    const curve = AudioParam.prototype.setValueCurveAtTime;
    AudioParam.prototype.setValueCurveAtTime = function (values, start, duration) {
      probe.curves.push({ values: Array.from(values), start, duration });
      return curve.call(this, values, start, duration);
    };
    const source = proto.createMediaElementSource;
    proto.createMediaElementSource = function (media) {
      const node = source.call(this, media); const analyser = this.createAnalyser(); analyser.fftSize = 1024;
      node.connect(analyser); const index = probe.media.length, connect = node.connect;
      (node as any).connect = function (dest: AudioNode) { probe.slots[index] = dest; return connect.call(node, dest); };
      probe.media.push(media); probe.analysers.push(analyser); return node;
    };
    const decode = proto.decodeAudioData;
    proto.decodeAudioData = function (...args: any[]) { probe.decodeCalls++; return (decode as any).apply(this, args); };
  }, lockUntilGesture);
}

test('bundled music plays after a gesture, overlaps tracks, follows settings and releases streams', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await observeAudio(page, true);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?e2e');
  await page.waitForFunction(() => !!(window as any).game?.world);
  expect(await page.evaluate(() => (window as any).__audioProbe.media.length)).toBe(0);
  const gesture = page.locator('#pause-match');
  if (testInfo.project.name === 'phone') await gesture.tap(); else await gesture.click();
  await page.waitForFunction(() => {
    const p = (window as any).__audioProbe;
    return p.media.length === 4 && p.media[0].currentTime > 1 && p.media[2].currentTime > 1;
  }, null, { timeout: 15_000 }).catch(async error => {
    const state = await page.evaluate(() => { const p = (window as any).__audioProbe; return { ctx: p.ctx?.state, errors: p.playErrors, media: p.media.map((m: HTMLMediaElement) => ({ src: m.src, time: m.currentTime, paused: m.paused, ready: m.readyState, error: m.error?.message })) }; });
    console.log(JSON.stringify(state)); throw error;
  });
  const loaded = await page.evaluate(() => {
    const p = (window as any).__audioProbe;
    return { state: p.ctx.state, decodeCalls: p.decodeCalls, tracks: p.media.map((m: HTMLAudioElement) => ({ src: m.src.split('/').pop(), duration: m.duration, ready: m.readyState })),
      pcmSignal: p.analysers.map((a: AnalyserNode) => { const data = new Float32Array(a.fftSize); a.getFloatTimeDomainData(data); return data.reduce((sum, x) => sum + x * x, 0) / data.length; }) };
  });
  expect(loaded.state).toBe('running'); expect(loaded.decodeCalls).toBe(0);
  expect(loaded.tracks.map((t: any) => t.src)).toEqual(['sunrise.mp3', 'peaks-of-atlas.mp3', 'honor-bound.mp3', 'honor-bound.mp3']);
  for (const track of loaded.tracks) expect(track.duration).toBeGreaterThan(140);
  await expect.poll(() => page.evaluate(() => {
    const p = (window as any).__audioProbe, a = p.analysers[0]; const data = new Float32Array(a.fftSize); a.getFloatTimeDomainData(data);
    return data.reduce((sum, x) => sum + x * x, 0) / data.length;
  })).toBeGreaterThan(0.000001);

  // Drive an actual media-clock join without waiting through the full recording.
  await page.evaluate(() => { const p = (window as any).__audioProbe; p.media[0].currentTime = p.media[0].duration - 1.9; });
  await page.waitForFunction(() => { const p = (window as any).__audioProbe; return p.curves.length >= 2 && p.media[1].currentTime >= 2 && p.media[0].paused; }, null, { timeout: 15_000 }).catch(async error => {
    console.log('join state', await page.evaluate(() => { const p = (window as any).__audioProbe; return { curves: p.curves.length, ctx: p.ctx?.state, errors: p.playErrors, media: p.media.map((m: HTMLMediaElement) => ({ time: m.currentTime, paused: m.paused, ready: m.readyState, error: m.error?.message })) }; }), errors); throw error;
  });
  const overlap = await page.evaluate(() => {
    const p = (window as any).__audioProbe, [out, incoming] = p.curves;
    return { power: out.values[32] ** 2 + incoming.values[32] ** 2, duration: out.duration,
      simultaneous: out.start === incoming.start };
  });
  expect(overlap.power).toBeCloseTo(1, 3); expect(overlap.duration).toBe(2);
  expect(overlap.simultaneous).toBe(true);
  // Combat routing still responds to the local player's actual event bus.
  await page.evaluate(() => { const w = (window as any).game.world; w.events.emit({ type: 'attacked', owner: w.localPlayer, id: 0, pos: { x: 0, z: 0 } }); });
  await expect.poll(() => page.evaluate(() => (window as any).__audioProbe.slots[2].dest.gain.value)).toBeGreaterThan(0.4);
  await expect.poll(() => page.evaluate(() => (window as any).__audioProbe.slots[0].dest.gain.value)).toBeLessThan(0.02);

  await page.locator('#pause-settings').click();
  await page.locator('#settings-music').evaluate(el => { const input = el as HTMLInputElement; input.value = '0'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(await page.evaluate(() => (window as any).__audioProbe.gains[1].gain.value)).toBe(0);
  expect(await page.evaluate(() => (window as any).__audioProbe.gains[2].gain.value)).toBeCloseTo(0.8);
  await page.locator('#settings-master').evaluate(el => { const input = el as HTMLInputElement; input.value = '0'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(await page.evaluate(() => (window as any).__audioProbe.gains[0].gain.value)).toBe(0);
  await page.evaluate(() => (window as any).game.dispose());
  expect(await page.evaluate(() => (window as any).__audioProbe.media.every((m: HTMLMediaElement) => m.paused && !m.getAttribute('src')))).toBe(true);
  expect(errors).toEqual([]);
  await testInfo.attach('stream-playback.json', { body: JSON.stringify({ loaded, overlap, decodedPlaylistBuffers: 0 }, null, 2), contentType: 'application/json' });
});

test('title credits identify the soundtrack, author, license and distributed track attribution', async ({ page }) => {
  await page.goto('/?title&e2e'); await page.locator('#title-credits').click();
  const credit = page.locator('#title-audio-credit'); await expect(credit).toContainText('Omri Lahav / Wildfire Games');
  await expect(credit).toContainText('Sunrise, Peaks of Atlas and Honor Bound');
  await expect(credit.locator('a', { hasText: 'CC BY-SA 3.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/3.0/');
  await expect(credit.locator('a', { hasText: 'Wildfire Games' })).toHaveAttribute('href', 'https://www.wildfiregames.com/');
  const attribution = await page.request.get('/audio/0ad/ATTRIBUTION.md'); expect(attribution.ok()).toBe(true);
  expect(await attribution.text()).toContain('Dror Parker');
  const license = await page.request.get('/audio/0ad/LICENSE.txt'); expect(await license.text()).toContain('Copyright (C) 2009 Wildfire Games');
});


test('the title Start gesture starts recorded music after asynchronous match loading', async ({ page }) => {
  test.setTimeout(120_000); await observeAudio(page);
  await page.goto('/?title&e2e'); await page.locator('#title-new').click();
  await page.locator('#title-map-size').selectOption('small'); await page.locator('#title-start').click();
  await page.waitForFunction(() => !!(window as any).game?.world, null, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const p = (window as any).__audioProbe;
    return p.ctx.state === 'running' && p.media.length === 4 && p.media[0].currentTime > 0.5;
  }, null, { timeout: 15_000 });
});
