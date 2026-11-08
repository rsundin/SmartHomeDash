// Holds the latest Home Assistant state objects, keyed by entity_id.
// Views subscribe to the entities they draw and re-render when one changes.

export class Store {
  #states = new Map();
  #watchers = new Set();

  get(id) { return id ? this.#states.get(id) : undefined; }

  all() { return [...this.#states.values()]; }

  replace(list) {
    this.#states.clear();
    for (const s of list) this.#states.set(s.entity_id, s);
    this.#emit(null);
  }

  update(state) {
    this.#states.set(state.entity_id, state);
    this.#emit(state.entity_id);
  }

  // Calls fn now and whenever one of ids changes (or everything is replaced).
  watch(ids, fn) {
    const set = ids ? new Set(ids.filter(Boolean)) : null;
    const w = (id) => { if (id === null || !set || set.has(id)) fn(); };
    this.#watchers.add(w);
    fn();
    return () => this.#watchers.delete(w);
  }

  #emit(id) { for (const w of this.#watchers) w(id); }
}
