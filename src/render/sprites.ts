import * as THREE from 'three';
import { TREE_FOLIAGE, TREE_TRUNK, VILLAGER } from './palette';

/** A procedural billboard. The plane's local origin is at the feet. */
export interface BillboardSprite {
  texture: THREE.CanvasTexture;
  /** World width of the plane. */
  width: number;
  /** World height of the plane. */
  height: number;
}

export interface SpriteSet {
  villagers: BillboardSprite[];
  trees: BillboardSprite[];
  berry: BillboardSprite;
  gold: BillboardSprite;
  shadow: THREE.CanvasTexture;
}

/** Draw every gameplay sprite once. No image files. */
export function createSprites(): SpriteSet {
  const tunics = [
    { cloth: css(VILLAGER.tunic), dark: '#5c2e0c', light: '#c47a3a' },
    { cloth: '#3d5a80', dark: '#1b334c', light: '#7f9ec4' },
    { cloth: '#2f6b4f', dark: '#173828', light: '#5ea67a' },
  ];
  return {
    villagers: tunics.map((tunic) => frame(drawVillager(tunic), 1.72)),
    trees: [frame(drawOak(), 3.45), frame(drawPine(), 4.05), frame(drawBroadleaf(), 3.15)],
    berry: frame(drawBerry(), 1.18),
    gold: frame(drawGold(), 1.12),
    shadow: canvasTexture(drawShadow()),
  };
}

interface Tunic {
  cloth: string;
  dark: string;
  light: string;
}

function drawVillager(tunic: Tunic): HTMLCanvasElement {
  const W = 128;
  const H = 200;
  const { canvas, ctx } = makeCanvas(W, H);
  const cx = W / 2;
  const skin = css(VILLAGER.head);
  const skinShade = css(VILLAGER.body);
  const outline = '#24180f';

  fillOutlined(ctx, () => roundRect(ctx, cx - 30, 128, 24, 64, 8), '#3a2e22', outline, 6);
  fillOutlined(ctx, () => roundRect(ctx, cx + 6, 128, 24, 64, 8), '#4e3d2e', outline, 6);
  fillOutlined(ctx, () => roundRect(ctx, cx - 34, 182, 30, 16, 6), '#2c2118', outline, 5);
  fillOutlined(ctx, () => roundRect(ctx, cx + 4, 182, 30, 16, 6), '#3a2a1e', outline, 5);

  const armL = ctx.createLinearGradient(cx - 48, 0, cx - 16, 0);
  armL.addColorStop(0, tunic.dark);
  armL.addColorStop(1, tunic.cloth);
  const armR = ctx.createLinearGradient(cx + 16, 0, cx + 48, 0);
  armR.addColorStop(0, tunic.cloth);
  armR.addColorStop(1, tunic.dark);
  fillOutlined(ctx, () => roundRect(ctx, cx - 50, 96, 20, 52, 8), armL, outline, 6);
  fillOutlined(ctx, () => roundRect(ctx, cx + 30, 96, 20, 52, 8), armR, outline, 6);

  const body = ctx.createLinearGradient(cx - 36, 0, cx + 36, 0);
  body.addColorStop(0, tunic.dark);
  body.addColorStop(0.38, tunic.light);
  body.addColorStop(1, tunic.dark);
  fillOutlined(
    ctx,
    () => {
      ctx.moveTo(cx - 28, 86);
      ctx.lineTo(cx + 28, 86);
      ctx.lineTo(cx + 36, 156);
      ctx.lineTo(cx - 36, 156);
      ctx.closePath();
    },
    body,
    outline,
    6,
  );
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(cx - 30, 142, 60, 9);
  ctx.fillStyle = skinShade;
  ctx.beginPath();
  ctx.arc(cx - 40, 150, 8, 0, Math.PI * 2);
  ctx.arc(cx + 40, 150, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.moveTo(cx - 16, 94);
  ctx.lineTo(cx - 4, 94);
  ctx.lineTo(cx - 10, 140);
  ctx.lineTo(cx - 22, 140);
  ctx.closePath();
  ctx.fill();

  const head = ctx.createRadialGradient(cx - 8, 52, 4, cx, 64, 30);
  head.addColorStop(0, '#f3d7bc');
  head.addColorStop(0.65, skin);
  head.addColorStop(1, skinShade);
  fillOutlined(ctx, () => ctx.arc(cx, 64, 28, 0, Math.PI * 2), head, outline, 6);

  ctx.fillStyle = '#3a2918';
  ctx.beginPath();
  ctx.ellipse(cx, 46, 30, 18, 0, Math.PI, 0);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = outline;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx - 24, 58, 8, 12, 0.2, 0, Math.PI * 2);
  ctx.ellipse(cx + 24, 58, 8, 12, -0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#2a2118';
  ctx.beginPath();
  ctx.ellipse(cx - 10, 66, 3.2, 4.2, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 10, 66, 3.2, 4.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8a5a3a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, 70);
  ctx.lineTo(cx - 2, 80);
  ctx.stroke();

  return canvas;
}

function drawOak(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(240, 300);
  const cx = 120;
  drawTrunk(ctx, cx, 168, 299, 22, 30);
  blob(ctx, cx, 150, 78, 64, '#1d3d16', '#3f7a34', '#8fbf68');
  blob(ctx, cx - 52, 168, 52, 44, '#163212', '#357029', '#6ea552');
  blob(ctx, cx + 56, 162, 50, 42, '#1a3814', '#2f6624', '#7eb85c');
  blob(ctx, cx + 8, 112, 58, 46, '#214818', '#498a3a', '#b6d98a');
  return canvas;
}

function drawPine(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(180, 320);
  const cx = 90;
  drawTrunk(ctx, cx, 210, 319, 14, 20);
  const layers: [number, number, number, string, string][] = [
    [250, 150, 78, '#1a3814', '#2f6624'],
    [200, 118, 64, '#1e4218', '#3f7a34'],
    [148, 86, 50, '#244e1c', '#498a3a'],
    [102, 52, 34, '#2a5a22', '#6ea552'],
  ];
  for (const [y, half, tip, dark, light] of layers) {
    const grad = ctx.createLinearGradient(cx - half, y, cx + half, y - tip);
    grad.addColorStop(0, dark);
    grad.addColorStop(0.45, light);
    grad.addColorStop(1, dark);
    fillOutlined(
      ctx,
      () => {
        ctx.moveTo(cx, y - tip);
        ctx.lineTo(cx + half, y);
        ctx.lineTo(cx - half, y);
        ctx.closePath();
      },
      grad,
      '#142810',
      6,
    );
  }
  return canvas;
}

function drawBroadleaf(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(260, 250);
  const cx = 130;
  drawTrunk(ctx, cx, 150, 249, 26, 34);
  blob(ctx, cx, 128, 96, 70, '#1a3414', '#3a722e', '#9ccc78');
  blob(ctx, cx - 70, 146, 58, 46, '#163010', '#2f5e24', '#6aaa4e');
  blob(ctx, cx + 72, 140, 60, 48, '#1c3a16', '#468033', '#88c46a');
  blob(ctx, cx, 96, 64, 40, '#24501c', '#5a9444', '#d2ecc0');
  return canvas;
}

function drawBerry(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(220, 150);
  const cx = 110;
  blob(ctx, cx, 92, 86, 46, '#142810', '#2c5a22', '#5a9440');
  blob(ctx, cx - 48, 100, 48, 34, '#183214', '#3f7a34', '#7cb85c');
  blob(ctx, cx + 50, 98, 46, 32, '#1a3816', '#357029', '#6aaa48');
  blob(ctx, cx + 4, 74, 40, 28, '#214818', '#4e8a3c', '#c6e6a4');
  const spots: [number, number, number][] = [
    [78, 88, 7],
    [98, 78, 6],
    [118, 92, 8],
    [136, 76, 6],
    [150, 96, 7],
    [90, 104, 5],
    [128, 108, 5],
  ];
  for (const [x, y, r] of spots) {
    const g = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, r);
    g.addColorStop(0, '#f0b0aa');
    g.addColorStop(0.45, '#d04540');
    g.addColorStop(1, '#7a1c24');
    fillOutlined(ctx, () => ctx.arc(x, y, r, 0, Math.PI * 2), g, '#4a1014', 2);
  }
  return canvas;
}

function drawGold(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(220, 160);
  rock(ctx, 78, 118, 36, 28, '#8a8074', '#5c5348', '#3a342c');
  rock(ctx, 142, 122, 40, 30, '#7a7268', '#4e463c', '#2e2822');
  rock(ctx, 110, 108, 34, 26, '#6e655c', '#463e36', '#241e18');
  rock(ctx, 92, 90, 30, 24, '#f4e2a0', '#e0b84a', '#8a6420');
  rock(ctx, 132, 86, 28, 22, '#fff1c2', '#f0cc62', '#a07828');
  rock(ctx, 112, 68, 22, 18, '#fff8dc', '#ffe08a', '#c4963a');
  return canvas;
}

function drawShadow(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.5)');
  g.addColorStop(0.42, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return canvas;
}

function drawTrunk(ctx: CanvasRenderingContext2D, cx: number, top: number, bottom: number, topW: number, botW: number): void {
  const trunk = css(TREE_TRUNK);
  const g = ctx.createLinearGradient(cx - botW, 0, cx + botW, 0);
  g.addColorStop(0, '#3a2614');
  g.addColorStop(0.4, trunk);
  g.addColorStop(1, '#2a1a0e');
  fillOutlined(
    ctx,
    () => {
      ctx.moveTo(cx - topW / 2, top);
      ctx.lineTo(cx + topW / 2, top);
      ctx.lineTo(cx + botW / 2, bottom);
      ctx.lineTo(cx - botW / 2, bottom);
      ctx.closePath();
    },
    g,
    '#1a100a',
    6,
  );
}

function blob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rim: string,
  mid: string,
  light: string,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y + 4, rx + 6, ry + 5, 0, 0, Math.PI * 2);
  ctx.fillStyle = rim;
  ctx.fill();
  const g = ctx.createRadialGradient(x - rx * 0.35, y - ry * 0.4, rx * 0.1, x, y, rx);
  g.addColorStop(0, light);
  g.addColorStop(0.45, mid);
  g.addColorStop(1, css(TREE_FOLIAGE[1]));
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
}

function rock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  light: string,
  mid: string,
  dark: string,
): void {
  const g = ctx.createRadialGradient(x - rx * 0.35, y - ry * 0.45, 2, x, y, rx);
  g.addColorStop(0, light);
  g.addColorStop(0.55, mid);
  g.addColorStop(1, dark);
  fillOutlined(ctx, () => ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2), g, '#241c14', 4);
  ctx.strokeStyle = 'rgba(40, 28, 16, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - rx * 0.4, y);
  ctx.lineTo(x + rx * 0.15, y + ry * 0.35);
  ctx.stroke();
}

function frame(canvas: HTMLCanvasElement, worldHeight: number): BillboardSprite {
  return {
    texture: canvasTexture(canvas),
    width: worldHeight * (canvas.width / canvas.height),
    height: worldHeight,
  };
}

function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  return { canvas, ctx };
}

function fillOutlined(
  ctx: CanvasRenderingContext2D,
  path: () => void,
  fill: string | CanvasGradient,
  stroke: string,
  width: number,
): void {
  ctx.beginPath();
  path();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}
