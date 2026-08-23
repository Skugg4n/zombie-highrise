// Meta progression: per-device records and small permanent perks, saved in
// localStorage with a versioned schema (migrate on load, never crash on
// garbage). The perk is a veteran's head start: extra starting scrap at
// 4 and 8 best nights. Each device's own record applies to its own player
// (clients report their bonus in the hello message; friends-trust model).
const KEY = 'zhr-meta';
const SCHEMA_VERSION = 1;

function defaults() {
  return { v: SCHEMA_VERSION, bestNights: 0, bestLevel: 1, totalKills: 0, runs: 0, wins: 0 };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const data = JSON.parse(raw);
    return migrate(data);
  } catch {
    return defaults();
  }
}

function migrate(data) {
  if (!data || typeof data !== 'object') return defaults();
  // v1 is the first schema; future versions add steps here.
  if (data.v === SCHEMA_VERSION) return { ...defaults(), ...data };
  return defaults();
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

export const meta = {

  recordRun(stats) {
    state.runs++;
    if (stats.won) state.wins = (state.wins || 0) + 1;
    state.bestNights = Math.max(state.bestNights, stats.nights || 0);
    state.bestLevel = Math.max(state.bestLevel, stats.level || 1);
    state.totalKills += stats.kills || 0;
    save();
  },

  // Permanent unlock: veteran scrap bonus.
  scrapBonus() {
    if (state.bestNights >= 8) return 50;
    if (state.bestNights >= 4) return 25;
    return 0;
  },

  summaryLine() {
    if (state.runs === 0) return '';
    const bonus = this.scrapBonus();
    return `Best: ${state.bestNights} night${state.bestNights === 1 ? '' : 's'} (floor ${state.bestLevel}) - ${state.totalKills} kills total`
      + (state.wins ? ` - ${state.wins} extraction${state.wins === 1 ? '' : 's'}` : '')
      + (bonus ? ` - veteran bonus +${bonus} scrap` : '');
  },
};
