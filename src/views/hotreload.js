// HOT RELOAD OF LEVEL DATA: ?hot=1
//
// Ola: "changing a number should rebuild the level without restarting the
// run." The loop before this was: edit the file, reload the page, click
// solo, wait for the level, walk back to the thing you were looking at.
// Half a minute per number. On a layout that is thirty numbers, most of
// an afternoon goes into walking.
//
// It works without a build step because ES modules are cached BY URL: a
// fresh query string is a fresh module. The file is polled rather than
// watched, because a browser cannot watch a disk and a dev server that
// could is a build step by another name.
//
// DEV ONLY, behind the flag. Nothing in here runs in a normal session.
const POLL_MS = 900;

export class LevelHotReload {
  // specPath(index) -> URL of that floor's data file, or null.
  // apply(index, spec)  -> called with the freshly imported spec.
  constructor({ specPath, apply, onError }) {
    this.specPath = specPath;
    this.apply = apply;
    this.onError = onError || ((e) => console.warn('[hot]', e));
    this.seen = new Map();          // path -> last body text
    this.timer = null;
    this.watching = new Set();
    this.reloads = 0;
  }

  watch(index) {
    const path = this.specPath(index);
    if (!path) return false;
    this.watching.add(index);
    if (!this.timer) this.timer = setInterval(() => this._poll(), POLL_MS);
    // Read the current text first, so starting the watch is not itself a
    // change. Without this the first poll always rebuilds.
    this._read(path).then((t) => { if (t !== null && !this.seen.has(path)) this.seen.set(path, t); });
    return true;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async _read(path) {
    try {
      const r = await fetch(path, { cache: 'no-store' });
      return r.ok ? await r.text() : null;
    } catch { return null; }
  }

  async _poll() {
    for (const index of this.watching) {
      const path = this.specPath(index);
      if (!path) continue;
      const text = await this._read(path);
      if (text === null) continue;
      const was = this.seen.get(path);
      if (was === undefined) { this.seen.set(path, text); continue; }
      if (text === was) continue;
      this.seen.set(path, text);
      await this._reload(index, path);
    }
  }

  async _reload(index, path) {
    try {
      // A fresh URL is a fresh module. The counter rather than a
      // timestamp so two edits inside the same millisecond still differ.
      const mod = await import(`${path}?hot=${++this.reloads}`);
      // The spec is the file's only meaningful export, whatever it is
      // called: L1, L2, and a sketch Ola writes tomorrow will be L7.
      const spec = Object.values(mod).find(
        (v) => v && typeof v === 'object' && v.archetype);
      if (!spec) throw new Error(`${path} exports no level spec`);
      this.apply(index, spec);
    } catch (e) {
      // A half-typed file is the normal case while someone is editing, so
      // this must never be fatal: report it and keep watching.
      this.onError(e);
    }
  }
}
