// Deterministic game-feel clips (?feelclip=N): scripted input over a
// fixed-seed solo session, captured on video for the feel-critic loop.
// The api is implemented in main.js:
//   spawnAt(type, x, z)   spawn a zombie at an exact position
//   grant(weapon)         give + equip a weapon with full ammo
//   equip(weapon)         switch active weapon
//   aim()                 snap yaw/pitch onto the nearest zombie's torso
//   fire()                one trigger pull
//   hold(seconds)         hold the trigger from now for N seconds (auto)
//   throwGrenade()        throw the selected throwable
//   setHp(n)              set own hp (for the damage clip)
//
// 1 pistol vs walker   2 SMG spraying a group   3 shotgun on a brute
// 4 machete swing      5 grenade throw + boom   6 taking damage, downed
export const FEEL_CLIPS = {
  1: {
    duration: 4.4,
    actions: [
      [0.1, (a) => a.spawnAt('walker', 8, 1.5)],
      [0.7, (a) => a.aim()],
      [1.0, (a) => { a.aim(); a.fire(); }],
      [1.7, (a) => { a.aim(); a.fire(); }],
      [2.4, (a) => { a.aim(); a.fire(); }],
      [3.4, (a) => a.aim()],
    ],
  },
  2: {
    duration: 5.6,
    actions: [
      [0.1, (a) => {
        a.grant('smg');
        a.spawnAt('walker', 7.5, -1.2);
        a.spawnAt('walker', 9.0, 0.4);
        a.spawnAt('walker', 8.2, 2.4);
        a.spawnAt('walker', 7.0, 4.0);
      }],
      [0.8, (a) => a.aim()],
      [1.0, (a) => { a.aim(); a.hold(3.2); }],
      [1.5, (a) => a.aim()],
      [2.0, (a) => a.aim()],
      [2.5, (a) => a.aim()],
      [3.0, (a) => a.aim()],
      [3.6, (a) => a.aim()],
      [4.4, (a) => a.aim()],
    ],
  },
  3: {
    duration: 5.2,
    actions: [
      [0.1, (a) => { a.grant('shotgun'); a.spawnAt('brute', 3.0, 1.8); }],
      [0.8, (a) => a.aim()],
      [1.1, (a) => { a.aim(); a.fire(); }],
      [2.3, (a) => { a.aim(); a.fire(); }],
      [3.5, (a) => { a.aim(); a.fire(); }],
    ],
  },
  4: {
    duration: 3.6,
    actions: [
      [0.1, (a) => { a.equip('machete'); a.spawnAt('walker', 1.8, 1.8) }],
      [0.8, (a) => a.aim()],
      [1.1, (a) => { a.aim(); a.fire(); }],
      [2.2, (a) => { a.aim(); a.fire(); }],
    ],
  },
  5: {
    duration: 6.5,
    actions: [
      [0.1, (a) => {
        a.spawnAt('walker', 10.6, 1.0);
        a.spawnAt('walker', 11.8, 2.2);
        a.spawnAt('walker', 11.0, 3.2);
      }],
      [0.8, (a) => a.aim()],
      [1.2, (a) => a.throwGrenade()],
      [4.8, (a) => a.aim()],
    ],
  },
  6: {
    duration: 7,
    actions: [
      [0.1, (a) => {
        a.setHp(25);
        a.spawnAt('runner', 1.4, 3.2);
        a.spawnAt('runner', -1.2, 3.4);
      }],
      [0.6, (a) => a.aim()],
    ],
  },
};
