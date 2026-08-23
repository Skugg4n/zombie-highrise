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

// The first spec of a given archetype, used by floors whose type is set
// but whose own sketch has not arrived yet. Keeps the campaign playable
// without inventing a layout nobody asked for.
export function specForArchetype(archetype) {
  for (const s of Object.values(SPECS)) if (s.archetype === archetype) return s;
  return null;
}

export function specFor(levelIndex) {
  return SPECS[levelIndex] || null;
}

// Name and one-line hook for the arrival card. The spec is the single
// source; TUNING.floorHooks supplies the mechanical twist (`mod`) only.
export function levelInfoFor(levelIndex) {
  const s = SPECS[levelIndex];
  return s ? { name: s.name, note: s.note } : null;
}
