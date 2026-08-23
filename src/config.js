// Central configuration and constants. Version is bumped on every change
// and shown in the UI corner (see ui/hud.js -> #version).
export const VERSION = '0.18.0';

export const CONFIG = {
  // Networking
  ROOM_PREFIX: 'zhr-v1-',
  CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  CODE_LENGTH: 4,
  INPUT_HZ: 20,           // client -> host input/pose rate
  SNAPSHOT_HZ: 15,        // host -> clients snapshot rate
  INTERP_DELAY_MS: 120,   // clients render remote entities this far in the past

  // Player
  PLAYER_HEIGHT: 1.6,     // eye height for flat modes

  // NOTE: the Phase 0 weapon and zombie constants used to live here and
  // were deleted in v0.14.2. Nothing read them, and two of them had drifted
  // into disagreeing with the values that actually run: they said the
  // pistol held 12 rounds and reloaded in 1.0 s, while the live pistol
  // holds 8 and reloads in 1.7. Balance lives in ONE place, src/game/
  // tuning.js: TUNING.player, TUNING.weapons and TUNING.enemies.

  // VR locomotion
  SNAP_TURN_DEG: 45,
  VR_MOVE_SPEED: 3.0,

  // World footprint: square interior of the playable area, set from the
  // lobby's play-size choice (roomscale VR walks this physically). The
  // spec's 2x2 / 5x5 / 10x14 map to squares of 3 / 6 / 12 m playable
  // (a hard 2 m square is unplayably tight for level layouts; noted in
  // OPEN-QUESTIONS.md).
  PLAY_AREA: 12,
};

export const PLAY_SIZES = { SMALL: 3, MEDIUM: 6, LARGE: 12 };

export function setPlayArea(metres) {
  CONFIG.PLAY_AREA = metres;
}

// URL parameters, parsed once.
export const PARAMS = new URLSearchParams(location.search);
export const PHOTOMODE = parseInt(PARAMS.get('photomode') || '0', 10) || 0;
export const UISTATE = PARAMS.get('uistate') || '';
export const FORCE_QUALITY = PARAMS.get('q') || '';
