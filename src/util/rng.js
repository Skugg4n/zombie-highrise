// Deterministic seeded RNG (mulberry32). Every peer generates the SAME
// level geometry from the shared (seed, levelIndex) pair, so levels are
// never sent over the network.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,                                              // [0, 1)
    range: (min, max) => min + next() * (max - min),   // [min, max)
    int: (min, max) => Math.floor(min + next() * (max - min + 1)), // [min, max]
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}
