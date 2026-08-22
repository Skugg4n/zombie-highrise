// Central configuration and constants. Version is bumped on every change
// and shown in the UI corner (see ui/hud.js -> #version).
export const VERSION = '0.1.1';

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
  PLAYER_SPEED: 4.0,      // m/s
  PLAYER_HP: 100,

  // Weapon (Phase 0: one pistol)
  PISTOL_DAMAGE: 1,
  PISTOL_MAG: 12,
  PISTOL_RELOAD_S: 1.0,
  PISTOL_COOLDOWN_S: 0.22,

  // Zombie (Phase 0: one walker)
  ZOMBIE_HP: 3,
  ZOMBIE_SPEED: 1.1,      // m/s
  ZOMBIE_ATTACK_RANGE: 1.1,
  ZOMBIE_DPS: 10,
  ZOMBIE_RESPAWN_S: 3.0,
  ZOMBIE_HIT_RADIUS: 0.55,

  // VR locomotion
  SNAP_TURN_DEG: 45,
  VR_MOVE_SPEED: 3.0,

  // World footprint (Phase 0: one MEDIUM ground-level layout)
  PLAY_AREA: 16,          // metres, square interior of the base
};

// URL parameters, parsed once.
export const PARAMS = new URLSearchParams(location.search);
export const PHOTOMODE = parseInt(PARAMS.get('photomode') || '0', 10) || 0;
export const UISTATE = PARAMS.get('uistate') || '';
export const FORCE_QUALITY = PARAMS.get('q') || '';
