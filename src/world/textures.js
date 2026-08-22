// Procedural canvas textures: everything is generated at boot from a
// seeded rng (deterministic per key), nothing is downloaded. One pipeline
// only (CanvasTexture, flipY default) per LESSONS.md.
import * as THREE from 'three';
import { makeRng } from '../util/rng.js';

const cache = new Map();

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function finish(c, repeat = 1) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 2;
  return tex;
}

const hex = (n) => '#' + n.toString(16).padStart(6, '0');

// Mottled noise over a base color: sand, dirt, concrete, plaster...
export function noiseTexture(key, base, speckles, { size = 256, density = 900, minR = 0.5, maxR = 2.5, alpha = 0.16, repeat = 4 } = {}) {
  const k = 'n:' + key;
  if (cache.has(k)) return cache.get(k);
  const rng = makeRng(hashKey(k));
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = hex(base);
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < density; i++) {
    const col = speckles[rng.int(0, speckles.length - 1)];
    ctx.fillStyle = hex(col);
    ctx.globalAlpha = alpha * rng.range(0.4, 1);
    ctx.beginPath();
    ctx.arc(rng.range(0, size), rng.range(0, size), rng.range(minR, maxR), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = finish(c, repeat);
  cache.set(k, tex);
  return tex;
}

// Horizontal planks with grain lines: crates, duckboards, wagon bed.
export function plankTexture(key, base, dark, { size = 256, planks = 5, repeat = 1 } = {}) {
  const k = 'p:' + key;
  if (cache.has(k)) return cache.get(k);
  const rng = makeRng(hashKey(k));
  const [c, ctx] = makeCanvas(size);
  const ph = size / planks;
  for (let i = 0; i < planks; i++) {
    const shade = rng.range(-14, 14) | 0;
    ctx.fillStyle = shift(base, shade);
    ctx.fillRect(0, i * ph, size, ph);
    ctx.strokeStyle = hex(dark);
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2;
    ctx.strokeRect(-2, i * ph + 1, size + 4, ph - 2);
    // grain
    ctx.globalAlpha = 0.14;
    for (let gLine = 0; gLine < 6; gLine++) {
      const y = i * ph + rng.range(2, ph - 2);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size * 0.3, y + rng.range(-3, 3), size * 0.7, y + rng.range(-3, 3), size, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  const tex = finish(c, repeat);
  cache.set(k, tex);
  return tex;
}

// Brushed/worn metal with scratches and stains: the elevator, weapons.
export function metalTexture(key, base, { size = 256, repeat = 1 } = {}) {
  const k = 'm:' + key;
  if (cache.has(k)) return cache.get(k);
  const rng = makeRng(hashKey(k));
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = hex(base);
  ctx.fillRect(0, 0, size, size);
  // vertical brushing
  for (let i = 0; i < 130; i++) {
    ctx.strokeStyle = rng.chance(0.5) ? '#ffffff' : '#000000';
    ctx.globalAlpha = 0.035;
    const x = rng.range(0, size);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + rng.range(-4, 4), size);
    ctx.stroke();
  }
  // rust stains
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = '#6e4a28';
    ctx.globalAlpha = rng.range(0.05, 0.16);
    const x = rng.range(0, size), y = rng.range(0, size);
    ctx.beginPath();
    ctx.ellipse(x, y, rng.range(5, 24), rng.range(3, 12), rng.range(0, 3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = finish(c, repeat);
  cache.set(k, tex);
  return tex;
}

// Stacked sandbag rows.
export function sandbagTexture(key, base, { size = 256, repeat = 2 } = {}) {
  const k = 's:' + key;
  if (cache.has(k)) return cache.get(k);
  const rng = makeRng(hashKey(k));
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = hex(base);
  ctx.fillRect(0, 0, size, size);
  const rows = 4, cols = 3;
  const bh = size / rows, bw = size / cols;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bw * 0.5;
    for (let col = -1; col < cols + 1; col++) {
      const x = col * bw + off, y = r * bh;
      ctx.fillStyle = shift(base, rng.range(-12, 12) | 0);
      roundRect(ctx, x + 2, y + 2, bw - 4, bh - 4, 9);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1;
      roundRect(ctx, x + 2, y + 2, bw - 4, bh - 4, 9);
      ctx.stroke();
    }
  }
  const tex = finish(c, repeat);
  cache.set(k, tex);
  return tex;
}

// Building facade: dark concrete with a window grid, a few windows lit
// warm (the hero high-rise and the skyline towers).
export function facadeTexture(key, base, { size = 256, cols = 6, rows = 10, litChance = 0.14, repeat = 1, emissiveOnly = false } = {}) {
  const k = 'f:' + key + (emissiveOnly ? ':e' : '');
  if (cache.has(k)) return cache.get(k);
  const rng = makeRng(hashKey(k));
  const [c, ctx] = makeCanvas(size);
  ctx.fillStyle = emissiveOnly ? '#000000' : hex(base);
  ctx.fillRect(0, 0, size, size);
  // Floor bands
  if (!emissiveOnly) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let r = 0; r <= rows; r++) ctx.fillRect(0, (r * size / rows) - 1, size, 2);
  }
  const cw = size / cols, rh = size / rows;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cw + cw * 0.22, y = r * rh + rh * 0.2;
      const w = cw * 0.56, h = rh * 0.58;
      const lit = rng.chance(litChance);
      const broken = !lit && rng.chance(0.12);
      if (emissiveOnly) {
        // Emissive layer: only the lit windows, on black. The base map
        // keeps ALL windows dark so daylight shows no glow.
        if (!lit) continue;
        ctx.fillStyle = rng.chance(0.5) ? '#e8b45c' : '#c89a48';
        ctx.fillRect(x, y, w, h);
        continue;
      }
      ctx.fillStyle = broken ? '#0a0a0c' : shift(0x232a33, rng.range(-8, 8) | 0);
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);
    }
  }
  const tex = finish(c, repeat);
  cache.set(k, tex);
  return tex;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shift(base, amount) {
  const r = Math.max(0, Math.min(255, ((base >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((base >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (base & 255) + amount));
  return `rgb(${r},${g},${b})`;
}

function hashKey(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
