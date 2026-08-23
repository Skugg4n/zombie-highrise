import * as THREE from 'three';

// Procedural WebAudio engine: every sound is synthesized (no asset files,
// nothing to download, same-origin by construction). Positional one-shots
// go through PannerNodes; the listener follows the camera every frame.
// The context unlocks on the first user gesture (iOS rule, LESSONS.md).

let ctx = null;
let master = null;
let noiseBuffer = null;
let ambience = null;         // { gain, stop() }
let unlocked = false;

function ensureCtx() {
  if (ctx) return true;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    // 2 s of white noise, reused by every noise-based sound.
    const len = ctx.sampleRate * 2;
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return true;
  } catch {
    return false;
  }
}

export function unlockAudio() {
  if (!ensureCtx()) return;
  if (ctx.state === 'suspended') ctx.resume();
  unlocked = true;
}

function out(pos) {
  // Returns the node new sounds should connect to: a panner at pos, or
  // the master bus for non-positional (own weapon, UI) sounds.
  if (!pos) return master;
  // Callers pass either a Vector3-like or a plain [x, y, z]. A mismatch
  // used to reach the panner as undefined and throw "non-finite value".
  const px = Array.isArray(pos) ? pos[0] : pos.x;
  const py = Array.isArray(pos) ? pos[1] : pos.y;
  const pz = Array.isArray(pos) ? pos[2] : pos.z;
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return master;
  const p = ctx.createPanner();
  p.panningModel = 'equalpower';   // HRTF is heavy on Quest; equalpower is fine
  p.distanceModel = 'inverse';
  p.refDistance = 2;
  p.maxDistance = 80;
  p.rolloffFactor = 1.2;
  p.positionX.value = px; p.positionY.value = py; p.positionZ.value = pz;
  p.connect(master);
  return p;
}

function envGain(dest, t0, peak, attack, decay) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  g.connect(dest);
  return g;
}

function noiseBurst(dest, { peak = 0.5, attack = 0.002, decay = 0.15, freq = 1200, q = 0.8, type = 'bandpass' }) {
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = envGain(dest, t0, peak, attack, decay);
  src.connect(filter).connect(g);
  src.start(t0);
  src.stop(t0 + attack + decay + 0.05);
}

function tone(dest, { freq = 440, endFreq = null, type = 'sine', peak = 0.3, attack = 0.005, decay = 0.2, detune = 0 }) {
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + attack + decay);
  osc.detune.value = detune;
  const g = envGain(dest, t0, peak, attack, decay);
  osc.connect(g);
  osc.start(t0);
  osc.stop(t0 + attack + decay + 0.05);
}

const RECIPES = {
  pistol: (d) => { noiseBurst(d, { peak: 0.5, decay: 0.09, freq: 1500, q: 0.7 }); tone(d, { freq: 160, endFreq: 60, type: 'triangle', peak: 0.35, decay: 0.07 }); },
  akimbo: (d) => RECIPES.pistol(d),
  shotgun: (d) => { noiseBurst(d, { peak: 0.8, decay: 0.28, freq: 500, q: 0.5, type: 'lowpass' }); tone(d, { freq: 90, endFreq: 40, type: 'triangle', peak: 0.55, decay: 0.2 }); },
  smg: (d) => { noiseBurst(d, { peak: 0.4, decay: 0.06, freq: 1900, q: 0.8 }); tone(d, { freq: 200, endFreq: 90, type: 'square', peak: 0.15, decay: 0.05 }); },
  ak: (d) => { noiseBurst(d, { peak: 0.55, decay: 0.11, freq: 1000, q: 0.6 }); tone(d, { freq: 130, endFreq: 55, type: 'triangle', peak: 0.4, decay: 0.1 }); },
  machete: (d) => noiseBurst(d, { peak: 0.3, attack: 0.01, decay: 0.12, freq: 2600, q: 2.5 }),
  // OUT OF AMMO. This is the primary "you are dry" signal and it has to
  // cut through a firefight: a hard mechanical CLICK, not a whisper.
  dryfire: (d) => {
    noiseBurst(d, { peak: 0.55, attack: 0.001, decay: 0.035, freq: 3400, q: 6 });
    tone(d, { freq: 1900, endFreq: 900, type: 'square', peak: 0.3, attack: 0.001, decay: 0.05 });
    setTimeout(() => ctx && noiseBurst(d, { peak: 0.3, attack: 0.001, decay: 0.03, freq: 2200, q: 5 }), 55);
  },
  // RELOAD, in three beats you can hear separately: the magazine
  // release, the empty mag hitting the floor, and the fresh one going in.
  // Ola could not tell a reload was happening at all, and in VR there is
  // no viewmodel to watch, so the sound has to carry it.
  reload: (d) => {
    noiseBurst(d, { peak: 0.32, attack: 0.001, decay: 0.05, freq: 2400, q: 4 });
    tone(d, { freq: 620, endFreq: 380, type: 'square', peak: 0.16, decay: 0.06 });
    setTimeout(() => ctx && noiseBurst(d, { peak: 0.24, attack: 0.002, decay: 0.14, freq: 900, q: 1.4 }), 170);
  },
  // The moment the fresh magazine SEATS. A solid mechanical clack plus a
  // rising two-note confirmation: the weapon is ready, go.
  magseat: (d) => {
    noiseBurst(d, { peak: 0.5, attack: 0.001, decay: 0.06, freq: 1500, q: 3 });
    tone(d, { freq: 240, endFreq: 150, type: 'square', peak: 0.3, attack: 0.001, decay: 0.08 });
    setTimeout(() => ctx && tone(d, { freq: 880, peak: 0.14, decay: 0.06 }), 70);
    setTimeout(() => ctx && tone(d, { freq: 1320, peak: 0.12, decay: 0.09 }), 130);
  },
  explosion: (d) => { noiseBurst(d, { peak: 1.0, attack: 0.005, decay: 0.7, freq: 300, q: 0.4, type: 'lowpass' }); tone(d, { freq: 55, endFreq: 28, type: 'sine', peak: 0.8, decay: 0.5 }); },
  zhit: (d) => { noiseBurst(d, { peak: 0.35, decay: 0.07, freq: 700, q: 1.5 }); tone(d, { freq: 220, endFreq: 140, type: 'sawtooth', peak: 0.1, decay: 0.08 }); },
  zdie: (d) => { tone(d, { freq: 170, endFreq: 55, type: 'sawtooth', peak: 0.3, attack: 0.02, decay: 0.5, detune: -30 }); noiseBurst(d, { peak: 0.2, attack: 0.05, decay: 0.3, freq: 400, q: 1 }); },
  groan: (d) => {
    const f = 75 + Math.random() * 60;
    tone(d, { freq: f, endFreq: f * 0.72, type: 'sawtooth', peak: 0.16, attack: 0.25, decay: 1.1, detune: -20 });
    tone(d, { freq: f * 1.02, endFreq: f * 0.7, type: 'sawtooth', peak: 0.12, attack: 0.3, decay: 1.0, detune: 25 });
  },
  hurt: (d) => tone(d, { freq: 300, endFreq: 120, type: 'square', peak: 0.2, attack: 0.01, decay: 0.18 }),
  heal: (d) => { tone(d, { freq: 520, peak: 0.14, decay: 0.12 }); setTimeout(() => ctx && tone(d, { freq: 780, peak: 0.14, decay: 0.16 }), 110); },
  pickup: (d) => { tone(d, { freq: 660, peak: 0.15, decay: 0.08 }); setTimeout(() => ctx && tone(d, { freq: 990, peak: 0.13, decay: 0.1 }), 70); },
  buy: (d) => { tone(d, { freq: 880, peak: 0.15, decay: 0.07 }); setTimeout(() => ctx && tone(d, { freq: 1320, peak: 0.13, decay: 0.12 }), 90); },
  ping: (d) => tone(d, { freq: 1150, endFreq: 1100, type: 'sine', peak: 0.22, attack: 0.01, decay: 0.35 }),
  minebeep: (d) => tone(d, { freq: 1500, peak: 0.15, decay: 0.05, type: 'square' }),
  smoke: (d) => noiseBurst(d, { peak: 0.3, attack: 0.05, decay: 1.2, freq: 900, q: 0.4, type: 'lowpass' }),
  ignite: (d) => { noiseBurst(d, { peak: 0.5, attack: 0.02, decay: 0.5, freq: 700, q: 0.5, type: 'lowpass' }); tone(d, { freq: 110, endFreq: 70, type: 'sawtooth', peak: 0.2, decay: 0.4 }); },
  doors: (d) => noiseBurst(d, { peak: 0.2, attack: 0.1, decay: 0.6, freq: 220, q: 1, type: 'lowpass' }),
  throw: (d) => noiseBurst(d, { peak: 0.12, attack: 0.01, decay: 0.1, freq: 1200, q: 1.5 }),
  scream: (d) => { tone(d, { freq: 1450, endFreq: 680, type: 'sawtooth', peak: 0.28, attack: 0.06, decay: 1.1, detune: 40 }); tone(d, { freq: 1480, endFreq: 700, type: 'square', peak: 0.12, attack: 0.08, decay: 1.0, detune: -35 }); },
  roar: (d) => { tone(d, { freq: 95, endFreq: 55, type: 'sawtooth', peak: 0.4, attack: 0.08, decay: 1.1, detune: -25 }); noiseBurst(d, { peak: 0.25, attack: 0.1, decay: 0.9, freq: 260, q: 0.6, type: 'lowpass' }); },
  crit: (d) => { tone(d, { freq: 1750, endFreq: 2300, type: 'square', peak: 0.2, attack: 0.004, decay: 0.1 }); tone(d, { freq: 900, endFreq: 1400, type: 'sine', peak: 0.16, decay: 0.12 }); },
  acid: (d) => noiseBurst(d, { peak: 0.3, attack: 0.01, decay: 0.35, freq: 800, q: 1.2, type: 'lowpass' }),
  // Base wall: a dull concrete thud while it holds, a heavy collapse when
  // a segment finally goes. The break has to carry across the whole field
  // because it is the worst thing that can happen to you on a holdout.
  // THE BASE UNDER ATTACK. Ola: "much louder and more urgent... the
  // player must feel the emergency without looking." Three tiers, chosen
  // by how close that section is to going: a body blow while it holds,
  // splintering wood as it loosens, and a heavy collapse when it goes.
  wallhit: (d) => {
    noiseBurst(d, { peak: 0.72, attack: 0.002, decay: 0.2, freq: 300, q: 1.0, type: 'lowpass' });
    tone(d, { freq: 110, endFreq: 62, type: 'square', peak: 0.38, decay: 0.16 });
  },
  // Wood giving way: bright cracking over the body blow. This is the
  // sound that tells you a section is nearly gone.
  wallcrack: (d) => {
    noiseBurst(d, { peak: 0.8, attack: 0.001, decay: 0.26, freq: 1500, q: 2.2 });
    noiseBurst(d, { peak: 0.6, attack: 0.004, decay: 0.34, freq: 420, q: 0.8, type: 'lowpass' });
    tone(d, { freq: 190, endFreq: 90, type: 'sawtooth', peak: 0.3, decay: 0.22 });
    setTimeout(() => ctx && noiseBurst(d, { peak: 0.45, attack: 0.001, decay: 0.18, freq: 2200, q: 3 }), 90);
  },
  wallbreak: (d) => {
    noiseBurst(d, { peak: 1.0, attack: 0.005, decay: 1.1, freq: 220, q: 0.45, type: 'lowpass' });
    noiseBurst(d, { peak: 0.7, attack: 0.001, decay: 0.5, freq: 1300, q: 1.6 });
    tone(d, { freq: 62, endFreq: 28, type: 'sine', peak: 0.75, decay: 0.9 });
    setTimeout(() => ctx && noiseBurst(d, { peak: 0.5, attack: 0.02, decay: 0.7, freq: 500, q: 0.7, type: 'lowpass' }), 160);
  },
  // A rising alarm as the perimeter as a whole gets close to failing.
  baseAlarm: (d) => {
    tone(d, { freq: 440, endFreq: 660, type: 'sawtooth', peak: 0.3, attack: 0.03, decay: 0.45, detune: -12 });
    tone(d, { freq: 442, endFreq: 664, type: 'square', peak: 0.14, attack: 0.05, decay: 0.4, detune: 18 });
  },
  repair: (d) => { noiseBurst(d, { peak: 0.22, decay: 0.06, freq: 2400, q: 3 }); setTimeout(() => ctx && noiseBurst(d, { peak: 0.2, decay: 0.07, freq: 1600, q: 2.5 }), 130); },
  dronefly: (d) => tone(d, { freq: 320, endFreq: 300, type: 'sawtooth', peak: 0.12, attack: 0.15, decay: 0.9, detune: 12 }),
  dronedrop: (d) => { tone(d, { freq: 420, endFreq: 180, type: 'square', peak: 0.16, decay: 0.14 }); noiseBurst(d, { peak: 0.2, attack: 0.01, decay: 0.2, freq: 600, q: 1.2 }); },
};

// Night stinger and day chime: little synth phrases.
function stinger(kind) {
  const t0 = ctx.currentTime;
  const chord = kind === 'night'
    ? [110, 130.8, 164.8]           // A minor-ish: dread
    : [261.6, 329.6, 392];          // C major: breathe out
  chord.forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = kind === 'night' ? 'sawtooth' : 'triangle';
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(kind === 'night' ? 0.12 : 0.08, t0 + 0.4 + i * 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);
    osc.connect(g).connect(master);
    osc.start(t0 + i * 0.1);
    osc.stop(t0 + 2.4);
  });
}

// Wind/drone ambience loop (filtered noise, slow LFO).
function startAmbience(mode) {
  stopAmbience();
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = mode === 'dark' ? 160 : 420;
  const g = ctx.createGain();
  g.gain.value = mode === 'dark' ? 0.05 : 0.045;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = mode === 'dark' ? 0.07 : 0.16;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = mode === 'dark' ? 0.015 : 0.025;
  lfo.connect(lfoGain).connect(g.gain);
  src.connect(filter).connect(g).connect(master);
  src.start();
  lfo.start();
  ambience = { stop() { try { src.stop(); lfo.stop(); } catch { /* done */ } } };
}
function stopAmbience() {
  if (ambience) { ambience.stop(); ambience = null; }
}

export const audio = {
  unlock: unlockAudio,
  get ready() { return unlocked && !!ctx; },

  // name from RECIPES; pos: optional {x,y,z} world position
  play(name, pos = null) {
    if (!unlocked || !ensureCtx()) return;
    const recipe = RECIPES[name];
    if (!recipe) {
      // A missing recipe used to be silence, which is indistinguishable
      // from a sound that is simply quiet. Half the sounds this game has
      // written were never played and nobody noticed for that reason.
      console.warn('[audio] no recipe for', name);
      return;
    }
    recipe(out(pos));
  },

  stinger(kind) {
    if (!unlocked || !ensureCtx()) return;
    stinger(kind);
  },

  ambience(mode) {   // 'day' | 'dark' | null
    if (!unlocked || !ensureCtx()) return;
    if (mode) startAmbience(mode); else stopAmbience();
  },

  // Called once per frame with the camera.
  updateListener(camera) {
    if (!ctx || !unlocked) return;
    const l = ctx.listener;
    const p = camera.getWorldPosition(_v1);
    camera.getWorldDirection(_v2);
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = _v2.x; l.forwardY.value = _v2.y; l.forwardZ.value = _v2.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else if (l.setPosition) {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(_v2.x, _v2.y, _v2.z, 0, 1, 0);
    }
  },
};

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
