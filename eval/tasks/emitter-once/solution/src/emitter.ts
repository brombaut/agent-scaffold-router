type Handler = (...args: any[]) => void;
type Entry = { fn: Handler; listener: Handler };

export class Emitter {
  private handlers = new Map<string, Entry[]>();

  on(event: string, fn: Handler): this {
    return this.add(event, { fn, listener: fn });
  }

  once(event: string, fn: Handler): this {
    const listener: Handler = (...args) => {
      this.off(event, fn);
      fn(...args);
    };
    return this.add(event, { fn, listener });
  }

  off(event: string, fn: Handler): this {
    const list = this.handlers.get(event);
    if (!list) return this;
    const i = list.findIndex((e) => e.fn === fn || e.listener === fn);
    if (i >= 0) list.splice(i, 1);
    return this;
  }

  emit(event: string, ...args: any[]): boolean {
    const list = this.handlers.get(event);
    if (!list || list.length === 0) return false;
    for (const entry of [...list]) entry.listener(...args);
    return true;
  }

  listenerCount(event: string): number {
    return this.handlers.get(event)?.length ?? 0;
  }

  private add(event: string, entry: Entry): this {
    const list = this.handlers.get(event) ?? [];
    list.push(entry);
    this.handlers.set(event, list);
    return this;
  }
}
