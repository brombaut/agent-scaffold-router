type Handler = (...args: any[]) => void;

export class Emitter {
  private handlers = new Map<string, Handler[]>();

  on(event: string, fn: Handler): this {
    const list = this.handlers.get(event) ?? [];
    list.push(fn);
    this.handlers.set(event, list);
    return this;
  }

  once(event: string, fn: Handler): this {
    const wrapper: Handler = (...args) => {
      this.off(event, wrapper);
      fn(...args);
    };
    return this.on(event, wrapper);
  }

  off(event: string, fn: Handler): this {
    const list = this.handlers.get(event);
    if (!list) return this;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
    return this;
  }

  emit(event: string, ...args: any[]): boolean {
    const list = this.handlers.get(event);
    if (!list || list.length === 0) return false;
    for (let i = 0; i < list.length; i++) list[i]!(...args);
    return true;
  }

  listenerCount(event: string): number {
    return this.handlers.get(event)?.length ?? 0;
  }
}
