/** Least-recently-used cache. Reads and writes both count as a use. */
export class LRUCache<K, V> {
  private map = new Map<K, V>();

  constructor(private capacity: number) {
    if (capacity < 1) throw new Error("capacity must be at least 1");
  }

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    return this.map.get(key);
  }

  set(key: K, value: V): void {
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
  }

  has(key: K): boolean {
    return this.map.has(key);
  }
}
