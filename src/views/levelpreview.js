// LEVEL PREVIEW: ?levelpreview=N
//
// Ola: "right now the only way for me to see a new layout is to play
// through it, which is the slowest possible loop. Five seconds instead of
// five minutes changes how many sketches I can try."
//
// So: any level, from above, labelled, without playing it. It draws what
// a person reading a sketch cares about, which is not what the game
// renders: where the base is, how far out each spawn ring sits and what it
// hides behind, which props are sight blockers, where the exit is, and how
// big any of it actually is.
//
// It is a READ of the built level, not a second implementation of it. If
// the preview shows it, the game has it.
import * as THREE from 'three';

const COL = {
  base: '#e0a33c',
  spawnNear: '#d83020',
  spawnMid: '#e0722c',
  spawnFar: '#8d6ad8',
  blocker: '#5c9ead',
  exit: '#7fb069',
  chasm: '#181c22',
  grid: 'rgba(255,255,255,0.06)',
  text: '#e8e4da',
  dim: '#8d9aa5',
};

// The overlay is 2D on purpose: labels that stay readable, a scale bar
// with real numbers, and a legend. A tilted 3D view looks better and
// answers fewer questions.
export function applyLevelPreview(level, { scene, camera, renderer }) {
  const b = level.playBounds || { minX: -40, maxX: 40, minZ: -40, maxZ: 40 };
  const centre = level.baseCentre || {
    x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2,
  };

  // How much world to show: everything, including the far spawns.
  let ext = 12;
  for (const s of level.zombieSpawns || []) {
    ext = Math.max(ext, Math.abs(s.x - centre.x), Math.abs(s.z - centre.z));
  }
  for (const p of level.spawnSources || []) {
    ext = Math.max(ext, Math.abs(p.x - centre.x), Math.abs(p.z - centre.z));
  }
  ext = Math.max(ext, (b.maxX - b.minX) / 2, (b.maxZ - b.minZ) / 2) + 6;

  // A plain orthographic top-down camera. No fog: fog is a game mechanic,
  // and hiding the layout is the opposite of what this is for.
  const aspect = innerWidth / innerHeight;
  const cam = new THREE.OrthographicCamera(
    -ext * aspect, ext * aspect, ext, -ext, 0.1, 400);
  cam.position.set(centre.x, 200, centre.z);
  cam.up.set(0, 0, -1);
  cam.lookAt(centre.x, 0, centre.z);
  scene.fog = null;
  // Ceilings would hide the whole interior of a traverse level.
  level.group.traverse((o) => {
    if (o.userData && o.userData.ceiling) o.visible = false;
  });
  // Flat, even light: this is a diagram, not a photograph.
  for (const o of scene.children) {
    if (o.isDirectionalLight) o.intensity = 1.4;
    if (o.isHemisphereLight) o.intensity = 1.6;
  }

  const overlay = buildOverlay(level, centre, ext, aspect);
  document.body.appendChild(overlay);

  return {
    camera: cam,
    render() { renderer.render(scene, cam); },
  };
}

// World to screen, for the labels.
function projector(centre, ext, aspect) {
  return (x, z) => ({
    left: ((x - centre.x) / (ext * aspect) * 0.5 + 0.5) * 100,
    top: ((z - centre.z) / ext * 0.5 + 0.5) * 100,
  });
}

function buildOverlay(level, centre, ext, aspect) {
  const root = document.createElement('div');
  root.id = 'levelpreview';
  root.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:900;
    font:12px/1.3 system-ui,sans-serif;color:${COL.text}`;
  const to = projector(centre, ext, aspect);

  const pin = (x, z, text, colour, sub) => {
    const p = to(x, z);
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;left:${p.left}%;top:${p.top}%;
      transform:translate(-50%,-50%);text-align:center;white-space:nowrap`;
    el.innerHTML = `<div style="width:9px;height:9px;border-radius:50%;
        background:${colour};margin:0 auto 3px;box-shadow:0 0 0 2px rgba(0,0,0,0.55)"></div>
      <div style="background:rgba(10,12,16,0.78);padding:2px 6px;border-radius:4px;
        border-left:3px solid ${colour}">${text}${
        sub ? `<span style="color:${COL.dim}"> ${sub}</span>` : ''}</div>`;
    root.appendChild(el);
  };

  // ---- The frame ----
  if (level.baseCentre) {
    const isRoute = level.objective === 'reach-exit';
    pin(level.baseCentre.x, level.baseCentre.z,
      isRoute ? 'ROOM' : 'BASE',
      COL.base,
      level.playableHalf ? `${(level.playableHalf * 2).toFixed(0)}m` : '');
  }
  for (const p of level.playerSpawns || []) {
    const q = to(p.x, p.z);
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;left:${q.left}%;top:${q.top}%;
      width:7px;height:7px;margin:-3px 0 0 -3px;border-radius:50%;
      background:${COL.base};opacity:0.85`;
    root.appendChild(el);
  }

  // ---- Spawns, coloured by ring and labelled with what they hide behind ----
  const sources = level.spawnSources || [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const d = level.baseCentre
      ? Math.hypot(s.x - level.baseCentre.x, s.z - level.baseCentre.z) : 0;
    const colour = s.ring === 'near' ? COL.spawnNear
      : s.ring === 'mid' ? COL.spawnMid : COL.spawnFar;
    pin(s.x, s.z, s.kind || 'spawn', colour, d ? `${d.toFixed(0)}m` : '');
  }

  // ---- The exit, if this level has one ----
  if (level.exitZone && level.objective === 'reach-exit') {
    pin(level.exitZone.x, level.exitZone.z, 'EXIT', COL.exit);
  } else if (level.elevatorZone) {
    pin(level.elevatorZone.x, level.elevatorZone.z, 'LIFT', COL.exit);
  }

  // ---- Hazards ----
  for (const v of level.voids || []) {
    pin(v.x, v.z, 'CHASM', COL.chasm, `${(v.hx * 2).toFixed(1)}x${(v.hz * 2).toFixed(1)}m`);
  }
  for (const d of level.doors || []) {
    pin(d.buttonX, d.buttonZ, 'DOOR', COL.blocker);
  }

  // ---- Legend and facts ----
  const legend = document.createElement('div');
  legend.style.cssText = `position:absolute;left:14px;top:14px;
    background:rgba(10,12,16,0.86);padding:10px 12px;border-radius:8px;
    border:1px solid rgba(255,255,255,0.12);line-height:1.6`;
  const rings = { near: 0, mid: 0, far: 0 };
  for (const s of sources) rings[s.ring || 'far'] = (rings[s.ring || 'far'] || 0) + 1;
  legend.innerHTML = `
    <div style="font-weight:700;font-size:14px">${level.name || 'LEVEL ' + level.index}</div>
    <div style="color:${COL.dim};max-width:280px">${level.note || ''}</div>
    <div style="margin-top:8px">archetype <b>${level.archetype || level.type}</b></div>
    <div>${(level.colliders || []).length} colliders, ${sources.length} spawns</div>
    <div style="margin-top:8px">
      <span style="color:${COL.spawnNear}">near ${rings.near || 0}</span> &nbsp;
      <span style="color:${COL.spawnMid}">mid ${rings.mid || 0}</span> &nbsp;
      <span style="color:${COL.spawnFar}">far ${rings.far || 0}</span>
    </div>
    <div style="margin-top:8px;color:${COL.dim}">
      ?levelpreview=N &nbsp;|&nbsp; view is ${(ext * 2).toFixed(0)} m across
    </div>`;
  root.appendChild(legend);

  // A scale bar, because "is that big enough to fight in" is the question
  // a top-down view is worst at answering.
  const barMetres = ext > 40 ? 20 : ext > 18 ? 10 : 5;
  const barPct = (barMetres / (ext * 2 * aspect)) * 100;
  const bar = document.createElement('div');
  bar.style.cssText = `position:absolute;left:14px;bottom:16px;
    background:rgba(10,12,16,0.86);padding:8px 10px;border-radius:6px`;
  bar.innerHTML = `<div style="width:${barPct}vw;height:4px;background:${COL.text};
      margin-bottom:4px"></div><div>${barMetres} m</div>`;
  root.appendChild(bar);
  return root;
}
