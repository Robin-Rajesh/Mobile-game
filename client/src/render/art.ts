import { TAU } from '../../../shared/math';
import type { Skin } from '../../../shared/skins';

export type Mood = 'idle' | 'surge' | 'scared' | 'happy' | 'chomp';

export interface FaceState {
  /** World-space look direction */
  look: number;
  /** 0 open … 1 closed */
  blink: number;
  mood: Mood;
  /** 0..1 mouth opening for eating */
  chomp: number;
}

/** Dust palette: candy tones that pop on the ink background, index 6 = gold. */
export const DUST_COLORS = ['#FF8FB1', '#FFD166', '#7CF5C8', '#7AA8FF', '#C49BFF', '#FF9F6B', '#FFE45C'];
export const INK = '#120B1F';

export function prismColor(t: number, offset = 0): string {
  const h = ((t * 60 + offset) % 360 + 360) % 360;
  return `hsl(${h} 95% 68%)`;
}

/**
 * Draw a core (body + face) centred at the origin with radius r.
 * Caller sets transform/alpha. `px` = size of one screen pixel in current units (for hairlines).
 */
export function drawCoreBody(ctx: CanvasRenderingContext2D, r: number, skin: Skin, face: FaceState, t: number, px: number): void {
  const body = skin.animated ? prismColor(t) : skin.body;
  const dark = skin.dark;
  const lw = Math.max(r * 0.11, 2.2 * px);

  // drop shadow — makes cores read as stickers sitting above the field
  ctx.fillStyle = 'rgba(5,2,12,0.45)';
  ctx.beginPath();
  ctx.ellipse(r * 0.08, r * 0.16, r * 1.02, r * 1.0, 0, 0, TAU);
  ctx.fill();

  // body
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();

  // shade crescent (lower right) via clip
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.clip();
  ctx.fillStyle = dark;
  ctx.globalAlpha *= 0.28;
  ctx.beginPath();
  ctx.rect(-r * 1.2, -r * 1.2, r * 2.4, r * 2.4);
  ctx.arc(-r * 0.14, -r * 0.16, r * 0.98, 0, TAU, true);
  ctx.fill();
  ctx.restore();

  // outline
  ctx.strokeStyle = dark;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(0, 0, r - lw * 0.5, 0, TAU);
  ctx.stroke();

  // highlight
  ctx.fillStyle = skin.animated ? '#ffffff' : skin.light;
  ctx.globalAlpha *= 0.9;
  ctx.beginPath();
  ctx.ellipse(-r * 0.42, -r * 0.46, r * 0.24, r * 0.12, -0.75, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-r * 0.14, -r * 0.66, r * 0.06, 0, TAU);
  ctx.fill();
  ctx.globalAlpha /= 0.9;

  drawFace(ctx, r, skin, face, t, px);
}

function drawFace(ctx: CanvasRenderingContext2D, r: number, skin: Skin, f: FaceState, t: number, px: number): void {
  const lx = Math.cos(f.look);
  const ly = Math.sin(f.look);
  // the whole face leans toward where it's going
  const ox = lx * r * 0.16;
  const oy = ly * r * 0.12 - r * 0.02;
  ctx.save();
  ctx.translate(ox, oy);
  const ink = INK;
  const thin = Math.max(r * 0.05, 1.2 * px);

  // cheeks
  if (skin.face !== 'visor') {
    ctx.fillStyle = '#FF5C8A';
    ctx.globalAlpha *= 0.35;
    ctx.beginPath();
    ctx.ellipse(-r * 0.52, r * 0.2, r * 0.15, r * 0.09, 0, 0, TAU);
    ctx.ellipse(r * 0.52, r * 0.2, r * 0.15, r * 0.09, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha /= 0.35;
  }

  const blink = f.mood === 'happy' ? 0 : f.blink;
  const angry = f.mood === 'surge' || skin.face === 'fangs';

  const eye = (ex: number, ey: number, er: number, sleepy: boolean, star: boolean) => {
    if (f.mood === 'happy') {
      // ^ ^ eyes
      ctx.strokeStyle = ink;
      ctx.lineWidth = thin * 1.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(ex, ey + er * 0.35, er * 0.7, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      return;
    }
    const h = er * (1 - blink * 0.92);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(ex, ey, er * 0.9, h, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = thin;
    ctx.stroke();
    if (h > er * 0.25) {
      const scared = f.mood === 'scared';
      const pr = er * (scared ? 0.38 : 0.55);
      const px2 = ex + lx * er * 0.32;
      const py2 = ey + ly * er * 0.32 * (h / er);
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(ex, ey, er * 0.9, h, 0, 0, TAU);
      ctx.clip();
      if (star) {
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.arc(px2, py2, pr, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#FFE45C';
        drawStar(ctx, px2, py2, pr * 0.85, pr * 0.3, t * 2);
      } else {
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.arc(px2, py2, pr, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(px2 - pr * 0.35, py2 - pr * 0.4, pr * 0.32, 0, TAU);
        ctx.fill();
      }
      if (sleepy) {
        ctx.fillStyle = skin.animated ? prismColor(t) : skin.body;
        ctx.fillRect(ex - er, ey - er * 1.1, er * 2, er * 0.95);
        ctx.strokeStyle = ink;
        ctx.lineWidth = thin;
        ctx.beginPath();
        ctx.moveTo(ex - er * 0.9, ey - er * 0.15);
        ctx.lineTo(ex + er * 0.9, ey - er * 0.15);
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  const er = r * 0.2;
  switch (skin.face) {
    case 'cyclops':
      eye(0, -r * 0.14, r * 0.32, false, false);
      break;
    case 'visor': {
      ctx.fillStyle = ink;
      roundRect(ctx, -r * 0.6, -r * 0.36, r * 1.2, r * 0.4, r * 0.2);
      ctx.fill();
      const glow = skin.moon;
      ctx.fillStyle = glow;
      const sh = r * 0.08 * (1 - blink * 0.8);
      const sx = lx * r * 0.08;
      roundRect(ctx, -r * 0.42 + sx, -r * 0.16 - sh / 2, r * 0.26, sh, sh / 2);
      ctx.fill();
      roundRect(ctx, r * 0.16 + sx, -r * 0.16 - sh / 2, r * 0.26, sh, sh / 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      const g = ((t * 0.6) % 2) - 0.5;
      ctx.beginPath();
      ctx.moveTo(-r * 0.6 + g * r * 1.2, -r * 0.36);
      ctx.lineTo(-r * 0.45 + g * r * 1.2, -r * 0.36);
      ctx.lineTo(-r * 0.6 + g * r * 1.2, r * 0.04);
      ctx.lineTo(-r * 0.75 + g * r * 1.2, r * 0.04);
      ctx.fill();
      break;
    }
    default:
      eye(-r * 0.3, -r * 0.14, er, skin.face === 'sleepy', skin.face === 'stars');
      eye(r * 0.3, -r * 0.14, er, skin.face === 'sleepy', skin.face === 'stars');
  }

  // brows when angry / surging
  if (angry && f.mood !== 'happy' && skin.face !== 'visor') {
    ctx.strokeStyle = ink;
    ctx.lineWidth = thin * 1.5;
    ctx.lineCap = 'round';
    const by = skin.face === 'cyclops' ? -r * 0.5 : -r * 0.4;
    ctx.beginPath();
    if (skin.face === 'cyclops') {
      ctx.moveTo(-r * 0.3, by - r * 0.06);
      ctx.lineTo(0, by + r * 0.04);
      ctx.lineTo(r * 0.3, by - r * 0.06);
    } else {
      ctx.moveTo(-r * 0.48, by - r * 0.06);
      ctx.lineTo(-r * 0.16, by + r * 0.05);
      ctx.moveTo(r * 0.48, by - r * 0.06);
      ctx.lineTo(r * 0.16, by + r * 0.05);
    }
    ctx.stroke();
  }

  // mouth
  const my = r * 0.26;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = thin * 1.2;
  ctx.lineCap = 'round';
  const open = Math.max(f.chomp, f.mood === 'chomp' ? 0.6 : 0);
  if (open > 0.05) {
    ctx.beginPath();
    ctx.ellipse(0, my + r * 0.02, r * 0.16, r * 0.04 + r * 0.14 * open, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#FF6B8B';
    ctx.beginPath();
    ctx.ellipse(0, my + r * 0.06 + r * 0.06 * open, r * 0.08, r * 0.05 * open, 0, 0, TAU);
    ctx.fill();
  } else if (f.mood === 'surge') {
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, -r * 0.2, my - r * 0.06, r * 0.4, r * 0.14, r * 0.05);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, my + r * 0.01);
    ctx.lineTo(r * 0.2, my + r * 0.01);
    ctx.stroke();
  } else if (f.mood === 'scared') {
    ctx.beginPath();
    ctx.ellipse(0, my + r * 0.03, r * 0.07, r * 0.09, 0, 0, TAU);
    ctx.fill();
  } else if (f.mood === 'happy') {
    ctx.beginPath();
    ctx.arc(0, my - r * 0.06, r * 0.2, 0.15, Math.PI - 0.15);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(0, my - r * 0.08, r * 0.13, 0.35, Math.PI - 0.35);
    ctx.stroke();
  }

  if (skin.face === 'fangs' && open <= 0.05) {
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = ink;
    ctx.lineWidth = thin * 0.7;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.1, my + r * 0.02);
      ctx.lineTo(s * r * 0.04, my + r * 0.02);
      ctx.lineTo(s * r * 0.07, my + r * 0.12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, outer: number, inner: number, rot: number, points = 4): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points;
    const rr = i % 2 === 0 ? outer : inner;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

// ───────────────────────────────────────────── moons (sprite cached)

const MOON_PX = 72;
const moonCache = new Map<string, HTMLCanvasElement>();

/** Moon sprite with its "front" facing +x (travel direction). */
export function moonSprite(skin: Skin, t: number): HTMLCanvasElement {
  const key = skin.animated ? `${skin.id}:${Math.floor(t * 6) % 36}` : `${skin.id}`;
  let c = moonCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = MOON_PX;
  const ctx = c.getContext('2d')!;
  ctx.translate(MOON_PX / 2, MOON_PX / 2);
  const r = MOON_PX * 0.36;
  const fill = skin.animated ? prismColor(t * 0.5, 180) : skin.moon;
  const dark = skin.moonDark;
  ctx.lineJoin = 'round';

  // shadow
  ctx.fillStyle = 'rgba(5,2,12,0.4)';
  ctx.beginPath();
  ctx.arc(r * 0.1, r * 0.18, r, 0, TAU);
  ctx.fill();

  switch (skin.moonStyle) {
    case 'gem': {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(r * 1.05, 0);
      ctx.lineTo(r * 0.2, -r * 0.85);
      ctx.lineTo(-r * 0.9, -r * 0.45);
      ctx.lineTo(-r * 0.9, r * 0.45);
      ctx.lineTo(r * 0.2, r * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.16;
      ctx.stroke();
      ctx.strokeStyle = dark;
      ctx.lineWidth = r * 0.08;
      ctx.beginPath();
      ctx.moveTo(r * 0.2, -r * 0.85);
      ctx.lineTo(-r * 0.1, 0);
      ctx.lineTo(r * 0.2, r * 0.85);
      ctx.moveTo(-r * 0.1, 0);
      ctx.lineTo(r * 1.05, 0);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.35);
      ctx.lineTo(-r * 0.25, -r * 0.55);
      ctx.lineTo(-r * 0.45, -r * 0.15);
      ctx.fill();
      break;
    }
    case 'ice': {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.16;
      ctx.stroke();
      ctx.strokeStyle = dark;
      ctx.lineWidth = r * 0.09;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI;
        ctx.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
        ctx.lineTo(-Math.cos(a) * r * 0.6, -Math.sin(a) * r * 0.6);
      }
      ctx.stroke();
      break;
    }
    default: {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      // shade
      ctx.save();
      ctx.clip();
      ctx.fillStyle = dark;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.rect(-r * 1.2, -r * 1.2, r * 2.4, r * 2.4);
      ctx.arc(-r * 0.18, -r * 0.2, r * 0.95, 0, TAU, true);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.16;
      ctx.beginPath();
      ctx.arc(0, 0, r - r * 0.08, 0, TAU);
      ctx.stroke();
      if (skin.moonStyle === 'crater' || skin.moonStyle === 'ringed') {
        ctx.fillStyle = dark;
        ctx.globalAlpha = 0.55;
        for (const [x, y, s] of [[-0.3, -0.25, 0.22], [0.3, 0.2, 0.17], [-0.15, 0.42, 0.11]]) {
          ctx.beginPath();
          ctx.arc(x * r, y * r, s * r, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (skin.moonStyle === 'eyeball') {
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(r * 0.18, 0, r * 0.62, 0, TAU);
        ctx.fill();
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.arc(r * 0.38, 0, r * 0.36, 0, TAU);
        ctx.fill();
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.arc(r * 0.46, 0, r * 0.18, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(r * 0.34, -r * 0.14, r * 0.08, 0, TAU);
        ctx.fill();
      }
      if (skin.moonStyle === 'ember') {
        ctx.fillStyle = '#FFF3B0';
        ctx.beginPath();
        ctx.arc(r * 0.15, -r * 0.1, r * 0.35, 0, TAU);
        ctx.fill();
      }
      if (skin.moonStyle === 'ringed') {
        ctx.strokeStyle = INK;
        ctx.lineWidth = r * 0.22;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.35, r * 0.38, -0.5, 0.15, Math.PI - 0.15);
        ctx.stroke();
        ctx.strokeStyle = dark;
        ctx.lineWidth = r * 0.1;
        ctx.stroke();
      }
      // highlight
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.ellipse(-r * 0.4, -r * 0.45, r * 0.2, r * 0.1, -0.7, 0, TAU);
      ctx.fill();
    }
  }
  moonCache.set(key, c);
  return c;
}

/** World units of moon radius → sprite draw size */
export const MOON_SPRITE_SCALE = MOON_PX / (MOON_PX * 0.36);

// ───────────────────────────────────────────── dust sprites

const dustCache: HTMLCanvasElement[] = [];
const DUST_PX = 48;
export const DUST_CORE_FRACTION = 9 / 24;

export function dustSprite(c: number): HTMLCanvasElement {
  let s = dustCache[c];
  if (s) return s;
  s = document.createElement('canvas');
  s.width = s.height = DUST_PX;
  const ctx = s.getContext('2d')!;
  const col = DUST_COLORS[c] ?? DUST_COLORS[0];
  const g = ctx.createRadialGradient(24, 24, 4, 24, 24, 24);
  g.addColorStop(0, col + 'AA');
  g.addColorStop(0.4, col + '33');
  g.addColorStop(1, col + '00');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, DUST_PX, DUST_PX);
  ctx.fillStyle = col;
  if (c === 6) {
    drawStar(ctx, 24, 24, 13, 4.5, 0);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(24, 24, 3.5, 0, TAU);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(24, 24, 9, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(21, 21, 3.2, 0, TAU);
    ctx.fill();
  }
  dustCache[c] = s;
  return s;
}
