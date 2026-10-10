#!/usr/bin/env node
/**
 * Warm-frame and render-budget benchmark for the visual refresh (PRETTY-3).
 *
 * Boots the seeded `?e2e` game in three fixed scenes (desktop low/high, emulated phone low),
 * selects every local villager, waits 2 s as `.agent-delivery/prettify/capture.mjs` did, then
 * samples requestAnimationFrame intervals. Compares the result with a baseline:
 *   - draw calls, triangles, GPU geometries and textures may not exceed the baseline scene;
 *   - pixel ratio, shadows, shadow map size, grass and water may not exceed the quality tiers;
 *   - median / p95 frame interval may not exceed baseline + max(2 ms, 10 %) with vsync pacing, or
 *     baseline + max(0.25 ms, 10 %) with --uncapped; Metal runs against a same-pacing baseline only.
 *
 * Metal (macOS hardware) is the default renderer. Other hosts can pass --software for structural
 * budgets only; frame timing is never compared for SwiftShader. The default baseline,
 * scripts/prettify-baseline.json, is structural only (counters of the seeded scene at 36a80cd), so a
 * fresh checkout checks structure and skips timing. Timing is only compared against a --baseline FILE
 * recorded by this script on the same machine with the same pacing.
 *
 * Needs a running server (default: vite on http://localhost:5175). Exits 1 on any violation.
 *
 *   node scripts/prettify-benchmark.mjs [--url URL] [--output FILE] [--baseline FILE]
 *     [--samples 180] [--runs 1] [--software] [--uncapped] [--screenshots] [--label NAME]
 */
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

const USAGE = `Usage: node scripts/prettify-benchmark.mjs [options]
  --url URL          game server (default http://localhost:5175)
  --output FILE      result JSON (default .agent-delivery/prettify/verified-metrics.json)
  --baseline FILE    baseline JSON (default scripts/prettify-baseline.json). One of:
                       - structural: {"format":"prettify-structural-baseline","scenarios":[{name,render,memory}]}
                         counters only, frame timing is skipped (the bundled default)
                       - an earlier --output of this script: structure and, on the same machine and
                         pacing, frame timing
                       - a legacy capture.mjs array: structure only (no environment metadata)
  --samples N        frame intervals per run, 30-2000 (default 180)
  --runs N           runs per scene, 1-10 (default 1)
  --software         SwiftShader instead of Metal (for non-macOS hosts); frame timing is not compared
  --uncapped         also pass --disable-frame-rate-limit --disable-gpu-vsync; timing allowance
                     becomes max(0.25 ms, 10 %) and needs an uncapped baseline
  --screenshots      save <label>-<scene>.png next to the output after sampling
  --label NAME       run name for the JSON and screenshots (default verified)

Metal (macOS hardware GPU) is the default. The --output FILE is a full-format baseline: {label,
environment:{renderer,uncapped,...}, scenarios:[{name, summary:{medianMs,p95Ms,maxRender,maxMemory}}]}.
Frame timing is only compared against one recorded on the same machine with the same flags, e.g.:

  # run this harness against a server serving the original revision
  node scripts/prettify-benchmark.mjs --url http://localhost:5176 --uncapped --runs 3 --label before --output /tmp/before.json
  # then against the updated server, with the same GPU, browser and flags
  node scripts/prettify-benchmark.mjs --url http://localhost:5175 --uncapped --runs 3 --baseline /tmp/before.json`;

/** Ceilings from src/core/quality.ts at the baseline commit (36a80cd). A tier may not exceed them. */
const QUALITY_CEILINGS = {
  low: { pixelRatio: 1, shadows: false, shadowMapSize: 0, grassDensity: 0, grassRadius: 0, fancyWater: false },
  medium: { pixelRatio: 1.5, shadows: true, shadowMapSize: 1024, grassDensity: 3, grassRadius: 28, fancyWater: true },
  high: { pixelRatio: 2, shadows: true, shadowMapSize: 2048, grassDensity: 7, grassRadius: 45, fancyWater: true },
};

const SCENARIOS = [
  { name: 'desktop-low', tier: 'low', width: 1280, height: 800 },
  { name: 'desktop-high', tier: 'high', width: 1280, height: 800 },
  { name: 'phone-low', tier: 'low', width: 390, height: 844, touch: true },
];

const METAL_ARGS = ['--use-angle=metal', '--ignore-gpu-blocklist'];
const SOFTWARE_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const UNCAPPED_ARGS = ['--disable-frame-rate-limit', '--disable-gpu-vsync'];
const STRUCTURAL = [
  ['render', 'calls'],
  ['render', 'triangles'],
  ['memory', 'geometries'],
  ['memory', 'textures'],
];
const BOOT_TIMEOUT = 60_000;
const SAMPLE_TIMEOUT = 120_000;

function options() {
  const { values } = parseArgs({
    options: {
      url: { type: 'string', default: 'http://localhost:5175' },
      output: { type: 'string', default: '.agent-delivery/prettify/verified-metrics.json' },
      baseline: { type: 'string', default: 'scripts/prettify-baseline.json' },
      samples: { type: 'string', default: '180' },
      runs: { type: 'string', default: '1' },
      software: { type: 'boolean', default: false },
      uncapped: { type: 'boolean', default: false },
      screenshots: { type: 'boolean', default: false },
      label: { type: 'string', default: 'verified' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const samples = Number(values.samples);
  const runs = Number(values.runs);
  if (!Number.isInteger(samples) || samples < 30 || samples > 2000) throw new Error('--samples must be an integer from 30 to 2000');
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('--runs must be an integer from 1 to 10');
  if (!/^[\w.-]+$/.test(values.label)) throw new Error('--label may only use letters, digits, ".", "_" and "-"');
  return { ...values, samples, runs };
}

/**
 * Baseline scenes by name. Accepts the bundled structural baseline (counters only, no timing),
 * a legacy capture.mjs array (structure only) or this script's output, whose
 * environment says which renderer and pacing produced it.
 */
async function loadBaseline(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    throw new Error(
      `baseline not found: ${path}\n` +
        'Run from the repository root to use the bundled scripts/prettify-baseline.json (structure only), or pass\n' +
        '--baseline FILE with an earlier --output of this script from the same machine and flags to compare timing.'
    );
  }
  const json = JSON.parse(text);
  if (json?.format === 'prettify-structural-baseline') {
    if (!Array.isArray(json.scenarios)) throw new Error(`${path}: structural baseline has no scenarios array`);
    if (json.qualityCeilings && JSON.stringify(json.qualityCeilings) !== JSON.stringify(QUALITY_CEILINGS)) {
      throw new Error(`${path}: qualityCeilings differ from the ceilings in this script`);
    }
    return {
      path,
      format: json.format,
      structuralOnly: true,
      renderer: null,
      uncapped: null,
      scenarios: new Map(json.scenarios.map((s) => [s.name, { render: s.render, memory: s.memory }])),
    };
  }
  if (Array.isArray(json)) {
    return {
      path,
      format: 'capture.mjs',
      structuralOnly: true,
      renderer: null,
      uncapped: null,
      scenarios: new Map(json.map((s) => [s.name, { medianMs: s.medianMs, p95Ms: s.p95Ms, render: s.render, memory: s.memory }])),
    };
  }
  if (!Array.isArray(json?.scenarios)) throw new Error(`${path}: expected a capture.mjs array or a benchmark result`);
  return {
    path,
    format: 'prettify-benchmark',
    environment: json.environment,
    renderer: json.environment?.renderer,
    uncapped: !!json.environment?.uncapped,
    scenarios: new Map(json.scenarios.map((s) => [s.name, { medianMs: s.summary.medianMs, p95Ms: s.summary.p95Ms, render: s.summary.maxRender, memory: s.summary.maxMemory }])),
  };
}

/** Collected in the page: frame intervals and per-frame maxima of renderer counters. */
async function sampleFrames(page, samples) {
  return page.evaluate(
    ({ samples, timeout }) =>
      new Promise((resolve, reject) => {
        const info = window.game.renderer.webgl.info;
        const maxRender = { calls: 0, triangles: 0, points: 0, lines: 0 };
        const maxMemory = { geometries: 0, textures: 0 };
        const deltas = [];
        let last = -1;
        const timer = setTimeout(() => reject(new Error(`only ${deltas.length} frames in ${timeout} ms`)), timeout);
        const tick = (now) => {
          // The first callback has no previous frame; its interval is discarded.
          if (last >= 0) {
            deltas.push(now - last);
            for (const k of Object.keys(maxRender)) maxRender[k] = Math.max(maxRender[k], info.render[k]);
            for (const k of Object.keys(maxMemory)) maxMemory[k] = Math.max(maxMemory[k], info.memory[k]);
          }
          last = now;
          if (deltas.length < samples) requestAnimationFrame(tick);
          else {
            clearTimeout(timer);
            resolve({
              deltas,
              maxRender,
              maxMemory,
              // The same end-of-sample snapshot capture.mjs recorded, for like-for-like reading.
              final: { render: { ...info.render }, memory: { ...info.memory } },
            });
          }
        };
        requestAnimationFrame(tick);
      }),
    { samples, timeout: SAMPLE_TIMEOUT }
  );
}

/** Renderer configuration the scene actually ended up with. */
async function inspectRenderer(page) {
  return page.evaluate(() => {
    const g = window.game;
    const webgl = g.renderer.webgl;
    const gl = webgl.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const textures = new Set();
    const collect = (value) => {
      if (value?.isTexture) textures.add(value);
      else if (Array.isArray(value)) value.forEach(collect);
    };
    let grassInstances = 0;
    let shadowMapSize = 0;
    g.renderer.scene.traverse((obj) => {
      if (obj.isLight && obj.castShadow && obj.shadow) shadowMapSize = Math.max(shadowMapSize, obj.shadow.mapSize.x, obj.shadow.mapSize.y);
      const materials = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      for (const m of materials) {
        for (const value of Object.values(m)) collect(value);
        for (const u of Object.values(m.uniforms ?? {})) collect(u?.value);
      }
    });
    g.grass?.object?.traverse((obj) => {
      if (obj.isInstancedMesh) grassInstances += obj.count;
    });
    let maxTexture = { width: 0, height: 0 };
    for (const t of textures) {
      const img = t.image;
      const w = img?.width ?? img?.videoWidth ?? 0;
      const h = img?.height ?? img?.videoHeight ?? 0;
      if (w * h > maxTexture.width * maxTexture.height) maxTexture = { width: w, height: h };
    }
    return {
      gpuVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
      gpuRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
      quality: { ...g.quality },
      devicePixelRatio: window.devicePixelRatio,
      pixelRatio: webgl.getPixelRatio(),
      drawingBuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
      shadows: { enabled: webgl.shadowMap.enabled, mapSize: webgl.shadowMap.enabled ? shadowMapSize : 0 },
      // Partial: only textures on material properties and material.uniforms. Textures captured in
      // onBeforeCompile closures are missed; texture resolution is covered by textures.test.ts.
      materialTexturesPartial: { count: textures.size, largest: maxTexture },
      grassInstances,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      boot: g.boot,
    };
  });
}

async function runScenario(browser, scenario, opts, run) {
  const context = await browser.newContext({
    viewport: { width: scenario.width, height: scenario.height },
    hasTouch: !!scenario.touch,
    isMobile: !!scenario.touch,
    deviceScaleFactor: 1,
  });
  const errors = [];
  try {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    await page.goto(`${opts.url.replace(/\/$/, '')}/?e2e&quality=${scenario.tier}`, { timeout: BOOT_TIMEOUT });
    await page.waitForFunction(() => window.game?.renderer.webgl.info.render.frame > 5, null, { timeout: BOOT_TIMEOUT });
    await page.locator('#loading').waitFor({ state: 'detached', timeout: BOOT_TIMEOUT });
    // Same scene as capture.mjs: every local villager selected, camera where the game put it.
    const selected = await page.evaluate(() => {
      const g = window.game;
      const ids = [...g.world.units.values()].filter((u) => u.kind === 'villager' && u.owner === g.world.localPlayer).map((u) => u.id);
      g.selection.set(ids);
      return ids.length;
    });
    await page.waitForTimeout(2000);
    const sample = await sampleFrames(page, opts.samples);
    const renderer = await inspectRenderer(page);
    let screenshot = null;
    if (opts.screenshots) {
      const suffix = opts.runs > 1 ? `-run${run + 1}` : '';
      screenshot = join(dirname(opts.output), `${opts.label}-${scenario.name}${suffix}.png`);
      await page.screenshot({ path: screenshot });
    }
    return { run: run + 1, selected, ...stats(sample.deltas), maxRender: sample.maxRender, maxMemory: sample.maxMemory, final: sample.final, renderer, screenshot, errors };
  } finally {
    await context.close();
  }
}

function stats(deltas) {
  const sorted = [...deltas].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return { samples: sorted.length, minMs: sorted[0], medianMs: at(0.5), p95Ms: at(0.95), maxMs: sorted[sorted.length - 1] };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const round = (x) => Math.round(x * 100) / 100;

function summarize(runs) {
  const max = (pick) => Object.fromEntries(Object.keys(pick(runs[0])).map((k) => [k, Math.max(...runs.map((r) => pick(r)[k]))]));
  return {
    // Across runs: median of each run's median and p95, and the highest counters seen in any frame.
    medianMs: median(runs.map((r) => r.medianMs)),
    p95Ms: median(runs.map((r) => r.p95Ms)),
    maxMs: Math.max(...runs.map((r) => r.maxMs)),
    maxRender: max((r) => r.maxRender),
    maxMemory: max((r) => r.maxMemory),
  };
}

function checkScenario(scenario, summary, runs, baseline, timing) {
  const violations = [];
  const add = (check, detail) => violations.push({ scenario: scenario.name, check, ...detail });
  for (const r of runs) {
    for (const error of r.errors) add('no-errors', { run: r.run, message: error });
    const { renderer: info } = r;
    const ceiling = QUALITY_CEILINGS[scenario.tier];
    if (info.quality.tier !== scenario.tier) add('quality-tier', { run: r.run, expected: scenario.tier, actual: info.quality.tier });
    for (const key of ['pixelRatio', 'shadowMapSize', 'grassDensity', 'grassRadius']) {
      if (info.quality[key] > ceiling[key]) add(`quality.${key}`, { run: r.run, limit: ceiling[key], actual: info.quality[key] });
    }
    for (const key of ['shadows', 'fancyWater']) {
      if (info.quality[key] && !ceiling[key]) add(`quality.${key}`, { run: r.run, limit: false, actual: true });
    }
    if (info.pixelRatio > Math.min(info.devicePixelRatio, ceiling.pixelRatio)) {
      add('pixel-ratio', { run: r.run, limit: Math.min(info.devicePixelRatio, ceiling.pixelRatio), actual: info.pixelRatio });
    }
    const scale = Math.min(info.devicePixelRatio, ceiling.pixelRatio);
    const buffer = { width: Math.ceil(scenario.width * scale), height: Math.ceil(scenario.height * scale) };
    if (info.drawingBuffer.width > buffer.width || info.drawingBuffer.height > buffer.height) {
      add('drawing-buffer', { run: r.run, limit: buffer, actual: info.drawingBuffer });
    }
    if (info.shadows.enabled && !ceiling.shadows) add('shadows.enabled', { run: r.run, limit: false, actual: true });
    if (info.shadows.mapSize > ceiling.shadowMapSize) add('shadows.mapSize', { run: r.run, limit: ceiling.shadowMapSize, actual: info.shadows.mapSize });
    if (info.overflowX > 0) add('horizontal-overflow', { run: r.run, actual: info.overflowX });
  }
  const base = baseline.scenarios.get(scenario.name);
  if (!base) {
    add('baseline-scene', { message: `no "${scenario.name}" scene in ${baseline.path}` });
    return { violations, timing: { compared: false, reason: 'no baseline scene' } };
  }
  // Counters are the per-frame maximum during sampling; the capture.mjs baseline is a single
  // end-of-sample frame, so this is the stricter side of the comparison.
  for (const [group, key] of STRUCTURAL) {
    const limit = base[group]?.[key];
    const actual = summary[group === 'render' ? 'maxRender' : 'maxMemory'][key];
    if (typeof limit !== 'number') add(`${group}.${key}`, { message: 'missing from baseline' });
    else if (actual > limit) add(`${group}.${key}`, { limit, actual });
  }
  if (!timing.compare) return { violations, timing: { compared: false, reason: timing.reason } };
  const result = { compared: true, uncapped: timing.uncapped, allowance: { floorMs: timing.floorMs, fraction: timing.fraction } };
  for (const key of ['medianMs', 'p95Ms']) {
    const limit = base[key] + Math.max(timing.floorMs, base[key] * timing.fraction);
    const deltaMs = summary[key] - base[key];
    const deltaPct = base[key] > 0 ? (deltaMs / base[key]) * 100 : null;
    result[key] = { baseline: base[key], limit: round(limit), actual: summary[key], deltaMs, deltaPct };
    if (summary[key] > limit) add(`frame.${key}`, { baseline: base[key], limit: round(limit), actual: summary[key], deltaMs, deltaPct });
  }
  return { violations, timing: result };
}

/**
 * Whether frame timing is comparable with the baseline, and the allowance if so. Vsync-paced
 * intervals sit near 16.7 ms with ~1 ms jitter, so they keep a 2 ms floor; uncapped intervals are
 * a few ms, where 2 ms would hide real regressions, so the floor drops to 0.25 ms.
 */
function timingPolicy(opts, baseline, environment) {
  const renderer = opts.software ? 'swiftshader' : 'metal';
  if (baseline.structuralOnly) return { compare: false, reason: 'structural baseline has no timing; pass --baseline FILE from this machine and pacing' };
  if (opts.software) return { compare: false, reason: 'SwiftShader run: software frame time says nothing about the Metal baseline' };
  if (/swiftshader|llvmpipe/i.test(environment.gpuRenderer ?? '')) return { compare: false, reason: `Metal was requested but WebGL reports "${environment.gpuRenderer}"` };
  if (baseline.renderer !== renderer) return { compare: false, reason: `baseline renderer is ${baseline.renderer ?? 'unknown'}` };
  if (baseline.uncapped !== opts.uncapped) return { compare: false, reason: `baseline pacing (${baseline.uncapped ? 'uncapped' : 'vsync'}) differs from this run` };
  for (const key of ['gpuRenderer', 'browser', 'platform', 'headless']) {
    if (baseline.environment?.[key] === undefined || baseline.environment[key] !== environment[key]) {
      return { compare: false, reason: `baseline ${key} is missing or differs from this run` };
    }
  }
  return { compare: true, uncapped: opts.uncapped, floorMs: opts.uncapped ? 0.25 : 2, fraction: 0.1 };
}

async function main() {
  const opts = options();
  const baseline = await loadBaseline(opts.baseline);
  // Created before any run so --screenshots can write into a custom output directory.
  await mkdir(dirname(opts.output), { recursive: true });
  const args = [...(opts.software ? SOFTWARE_ARGS : METAL_ARGS), ...(opts.uncapped ? UNCAPPED_ARGS : [])];
  const browser = await chromium.launch({ args });
  const scenarios = [];
  const violations = [];
  let environment;
  try {
    for (const scenario of SCENARIOS) {
      const runs = [];
      for (let i = 0; i < opts.runs; i++) {
        process.stderr.write(`${scenario.name} run ${i + 1}/${opts.runs}…\n`);
        runs.push(await runScenario(browser, scenario, opts, i));
      }
      environment ??= {
        browser: `chromium ${browser.version()}`,
        renderer: opts.software ? 'swiftshader' : 'metal',
        launchArgs: args,
        uncapped: opts.uncapped,
        headless: true,
        gpuVendor: runs[0].renderer.gpuVendor,
        gpuRenderer: runs[0].renderer.gpuRenderer,
        platform: `${process.platform} ${process.arch}`,
        node: process.version,
      };
      const summary = summarize(runs);
      const checked = checkScenario(scenario, summary, runs, baseline, timingPolicy(opts, baseline, environment));
      violations.push(...checked.violations);
      scenarios.push({ ...scenario, summary, timing: checked.timing, runs });
    }
  } finally {
    await browser.close();
  }

  const caveats = [
    'Frame intervals are requestAnimationFrame deltas in headless Chromium. With vsync pacing a 60 Hz display caps them near 16.7 ms, which hides spare GPU capacity; use --uncapped against an uncapped baseline from the same machine to see headroom.',
    'Uncapped intervals measure how fast frames are submitted and requestAnimationFrame fires, not precise GPU completion latency; queued GPU work can lag behind them.',
    'phone-low is a 390x844 touch/mobile emulation on this machine, not a measurement of any phone.',
    'Render and memory counters are the highest value seen in any sampled frame; the capture.mjs baseline is one end-of-sample frame. render.frame is not compared.',
    'Quality ceilings are the src/core/quality.ts tiers at the baseline commit (36a80cd).',
    'renderer.materialTexturesPartial only sees textures on material properties and material.uniforms, not ones captured in onBeforeCompile closures; it is not an inventory. Texture resolution is checked by textures.test.ts, not here.',
  ];
  if (opts.software) caveats.push('SwiftShader run: frame timing was not compared; structural budgets were.');
  if (baseline.structuralOnly) caveats.push(`Structural baseline (${opts.baseline}): frame timing was not compared; structural budgets were.`);
  const result = {
    label: opts.label,
    generatedAt: new Date().toISOString(),
    url: opts.url,
    samplesPerRun: opts.samples,
    runsPerScenario: opts.runs,
    baseline: { path: opts.baseline, format: baseline.format, structuralOnly: !!baseline.structuralOnly, renderer: baseline.renderer, uncapped: baseline.uncapped },
    environment,
    caveats,
    scenarios,
    violations,
    pass: violations.length === 0,
  };
  await writeFile(opts.output, `${JSON.stringify(result, null, 2)}\n`);

  console.log(`${environment.browser} · ${environment.gpuRenderer ?? 'GPU renderer unavailable'} · ${opts.samples} samples × ${opts.runs} run(s)`);
  for (const s of scenarios) {
    const m = s.summary;
    const delta = ({ deltaMs, deltaPct }) => `${deltaMs >= 0 ? '+' : ''}${round(deltaMs)} ms${deltaPct === null ? '' : ` (${deltaPct >= 0 ? '+' : ''}${round(deltaPct)}%)`}`;
    const timing = s.timing.compared
      ? `vs baseline median ${delta(s.timing.medianMs)} p95 ${delta(s.timing.p95Ms)} ok=${!violations.some((v) => v.scenario === s.name && v.check.startsWith('frame.'))}`
      : `timing not compared (${s.timing.reason})`;
    console.log(
      `${s.name.padEnd(13)} median ${round(m.medianMs)} ms  p95 ${round(m.p95Ms)} ms  max ${round(m.maxMs)} ms  ` +
        `calls ${m.maxRender.calls}  tris ${m.maxRender.triangles}  geo ${m.maxMemory.geometries}  tex ${m.maxMemory.textures}  · ${timing}`
    );
  }
  for (const v of violations) console.log(`VIOLATION ${v.scenario} ${v.check}: ${JSON.stringify({ ...v, scenario: undefined, check: undefined })}`);
  console.log(`${violations.length ? 'FAIL' : 'PASS'} · ${violations.length} violation(s) · ${opts.output}`);
  process.exitCode = violations.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 2;
});
