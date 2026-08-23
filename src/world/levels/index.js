// THE SKETCH REGISTRY.
//
// One floor number -> one spec file. A new sketch from Ola is one new file
// in this directory plus one line in SPECS, and nothing else. If a floor is
// not listed here it falls through to the legacy hand-written builders in
// levelgen.js.
//
// LEVEL_TYPES in levelgen.js still decides the level's TYPE STRING, because
// the sim reads it for wave budgets and phase rules. Keep the two in step:
// a spec-driven floor needs its type string to match its archetype.
import { L1 } from './L1.js';
import { L2 } from './L2.js';

export const SPECS = {
  1: L1,
  2: L2,
};

// Where each floor's data file lives, for the hot reloader to poll. Kept
// beside SPECS so adding a sketch is still one file and one line.
//
// Resolved against THIS module's own URL, which matters more than it
// looks: `fetch` resolves a relative path against the DOCUMENT and
// `import()` resolves it against the calling MODULE, so one relative
// string cannot serve both. The first version polled the right file and
// imported a path two directories deep that does not exist. An absolute
// URL is the same URL to both, and it survives being served from a
// subdirectory, which GitHub Pages does.
const SPEC_FILES = { 1: './L1.js', 2: './L2.js' };
export function specUrl(levelIndex) {
  const f = SPEC_FILES[levelIndex];
  return f ? new URL(f, import.meta.url).href : null;
}

// The first spec of a given archetype, used by floors whose type is set
// but whose own sketch has not arrived yet. Keeps the campaign playable
// without inventing a layout nobody asked for.
export function specForArchetype(archetype) {
  for (const s of Object.values(SPECS)) if (s.archetype === archetype) return s;
  return null;
}

// HOT RELOAD (?hot=1) drops a freshly imported spec in here, and the
// builder consults it before the compiled-in registry. Empty in a normal
// session, so there is one lookup and no other difference.
const OVERRIDES = new Map();
export function overrideSpec(levelIndex, spec) {
  if (spec) OVERRIDES.set(levelIndex, spec);
  else OVERRIDES.delete(levelIndex);
}

export function specFor(levelIndex) {
  return OVERRIDES.get(levelIndex) || SPECS[levelIndex] || null;
}

// Name and one-line hook for the arrival card. The spec is the single
// source; TUNING.floorHooks supplies the mechanical twist (`mod`) only.
export function levelInfoFor(levelIndex) {
  const s = SPECS[levelIndex];
  return s ? { name: s.name, note: s.note } : null;
}
