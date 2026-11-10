// Holds the latest Home Assistant state objects, keyed by entity_id.
// Views subscribe to the entities they draw and re-render when one changes.
//
// Changes are batched: watchers run once per animation frame, however many of their
// entities changed in it. A hidden page gets no frames, so nothing is redrawn until it
// is shown again, and then only once.

const nextFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);

export class Store {
  #states = new Map();
  #watchers = new Set();
  #pending = null; // entity ids changed since the last frame

  get(id) { return id ? this.#states.get(id) : undefined; }

  all() { return [...this.#states.values()]; }

  // Everything at once (on connect): watchers run straight away.
  replace(list) {
    this.#states.clear();
    for (const s of list) this.#states.set(s.entity_id, s);
    this.#pending = null;
    this.#emit(null);
  }

  update(state) {
    this.#states.set(state.entity_id, state);
    if (!this.#pending) {
      this.#pending = new Set();
      nextFrame(() => this.flush());
    }
    this.#pending.add(state.entity_id);
  }

  // Runs the watchers of everything changed since the last frame now.
  flush() {
    const ids = this.#pending;
    this.#pending = null;
    if (ids?.size) this.#emit(ids);
  }

  // Calls fn now and whenever one of ids changes (or everything is replaced).
  watch(ids, fn) {
    const set = ids ? new Set(ids.filter(Boolean)) : null;
    const w = (changed) => {
      if (changed === null || !set) { fn(); return; }
      for (const id of changed) if (set.has(id)) { fn(); return; }
    };
    this.#watchers.add(w);
    fn();
    return () => this.#watchers.delete(w);
  }

  #emit(changed) { for (const w of this.#watchers) w(changed); }
}
