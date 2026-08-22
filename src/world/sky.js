// Gradient sky dome + sun glow + dust motes. The dome is a tiny shader
// with three uniform colors (zenith, horizon, ground haze) lerped by the
// day/night controller every frame; far cheaper and far prettier than a
// flat clear color.
import * as THREE from 'three';

export function makeSkyDome() {
  const uniforms = {
    uTop: { value: new THREE.Color(0x7fb2e0) },
    uHorizon: { value: new THREE.Color(0xe8dcc0) },
    uGround: { value: new THREE.Color(0xcabb96) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 pos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = pos.xyww;   // always at the far plane
      }
    `,
    fragmentShader: `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGround;
      varying vec3 vDir;
      void main() {
        float h = normalize(vDir).y;
        vec3 col = h > 0.0
          ? mix(uHorizon, uTop, pow(min(h * 1.6, 1.0), 0.7))
          : mix(uHorizon, uGround, min(-h * 3.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(320, 24, 12), material);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  return { dome, uniforms };
}

// Soft round glow sprite for the sun / moon.
export function makeSunGlow() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,250,235,1)');
  g.addColorStop(0.25, 'rgba(255,238,190,0.7)');
  g.addColorStop(1, 'rgba(255,230,170,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, fog: false,
  }));
  sprite.scale.setScalar(60);
  return sprite;
}

// Dust motes drifting in the air near the player (art-direction detail).
export function makeDustMotes(count = 160, spread = 18) {
  const positions = new Float32Array(count * 3);
  const speeds = [];
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() * 2 - 1) * spread;
    positions[i * 3 + 1] = Math.random() * 4 + 0.3;
    positions[i * 3 + 2] = (Math.random() * 2 - 1) * spread;
    speeds.push({
      x: (Math.random() - 0.5) * 0.14,
      y: (Math.random() - 0.5) * 0.05,
      z: (Math.random() - 0.5) * 0.14,
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // Soft round sprite: bare points render as hard squares.
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const cx = c.getContext('2d');
  const grad = cx.createRadialGradient(16, 16, 1, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,244,220,0.9)');
  grad.addColorStop(1, 'rgba(255,244,220,0)');
  cx.fillStyle = grad;
  cx.fillRect(0, 0, 32, 32);
  const mat = new THREE.PointsMaterial({
    map: new THREE.CanvasTexture(c), size: 0.05, transparent: true, opacity: 0.5,
    depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const api = {
    points,
    update(dt, center) {
      const arr = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        arr[i * 3] += speeds[i].x * dt;
        arr[i * 3 + 1] += speeds[i].y * dt;
        arr[i * 3 + 2] += speeds[i].z * dt;
        // Wrap around the player so the cloud follows them.
        for (const [axis, c] of [[0, center.x], [2, center.z]]) {
          const v = arr[i * 3 + axis];
          if (v < c - spread) arr[i * 3 + axis] = v + spread * 2;
          else if (v > c + spread) arr[i * 3 + axis] = v - spread * 2;
        }
        if (arr[i * 3 + 1] < 0.1) arr[i * 3 + 1] = 4;
        else if (arr[i * 3 + 1] > 4.5) arr[i * 3 + 1] = 0.3;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
  return api;
}
