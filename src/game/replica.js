// Client-side replica of the host state. Buffers snapshots and samples
// them INTERP_DELAY_MS in the past, interpolating between the two
// surrounding snapshots so remote players and the zombie move smoothly
// (LESSONS.md: rendering the raw latest position looks jittery).
import { CONFIG } from '../config.js';

const lerp = (a, b, t) => a + (b - a) * t;
const lerpArr = (a, b, t) => a.map((v, i) => lerp(v, b[i] ?? v, t));
// Shortest-path angle interpolation for yaw.
function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Replica {
  constructor() {
    this.buffer = [];        // [{ recvAt, snap }] sorted by arrival
    this.latest = null;
  }

  push(snap) {
    this.buffer.push({ recvAt: performance.now(), snap });
    this.latest = snap;
    // Keep a short history; 2 s is plenty at 15 Hz.
    const cutoff = performance.now() - 2000;
    while (this.buffer.length > 2 && this.buffer[0].recvAt < cutoff) this.buffer.shift();
  }

  // Returns { players, z } interpolated at (now - INTERP_DELAY_MS), or null.
  sample() {
    const n = this.buffer.length;
    if (n === 0) return null;
    if (n === 1) return this.buffer[0].snap;
    const t = performance.now() - CONFIG.INTERP_DELAY_MS;
    // Find the two snapshots surrounding t.
    let a = this.buffer[0], b = this.buffer[n - 1];
    for (let i = 0; i < n - 1; i++) {
      if (this.buffer[i].recvAt <= t && this.buffer[i + 1].recvAt >= t) {
        a = this.buffer[i]; b = this.buffer[i + 1];
        break;
      }
    }
    if (t >= b.recvAt) return b.snap;   // fell behind: hold latest
    const span = Math.max(1, b.recvAt - a.recvAt);
    const f = Math.min(1, Math.max(0, (t - a.recvAt) / span));

    const players = {};
    for (const [id, pb] of Object.entries(b.snap.players || {})) {
      const pa = (a.snap.players || {})[id];
      if (!pa) { players[id] = pb; continue; }
      players[id] = {
        ...pb,
        p: lerpArr(pa.p, pb.p, f),
        ry: lerpAngle(pa.ry, pb.ry, f),
        rx: lerp(pa.rx, pb.rx, f),
        h: pb.h && pa.h ? { p: lerpArr(pa.h.p, pb.h.p, f), q: pb.h.q } : pb.h,
        hl: pb.hl && pa.hl ? { p: lerpArr(pa.hl.p, pb.hl.p, f), q: pb.hl.q } : pb.hl,
        hr: pb.hr && pa.hr ? { p: lerpArr(pa.hr.p, pb.hr.p, f), q: pb.hr.q } : pb.hr,
      };
    }
    const za = a.snap.z, zb = b.snap.z;
    const z = zb && za && zb.alive && za.alive
      ? { ...zb, p: lerpArr(za.p, zb.p, f) }
      : zb;
    return { players, z };
  }
}
