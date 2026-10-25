import type { RateLimitPolicy, QuotaState } from "../models";

export interface Entry {
  policy: RateLimitPolicy;
  state: QuotaState;
  isolated: boolean;
}

/** One store per tenant. Iterators retain no separate historical key list. */
export class TenantStore {
  readonly clients = new Map<string, Entry>();
  readonly aggregates = new Map<string, Entry>();
  private cursor: MapIterator<[string, Entry]> | undefined;

  nextClient(): [string, Entry] | undefined {
    this.cursor ??= this.clients.entries();
    let item = this.cursor.next();
    if (item.done) {
      this.cursor = this.clients.entries();
      item = this.cursor.next();
    }
    return item.done ? undefined : item.value;
  }

  clear(): number {
    const count = this.clients.size + this.aggregates.size;
    this.clients.clear();
    this.aggregates.clear();
    this.cursor = undefined;
    return count;
  }

  estimatedBytes(): number {
    // Planning estimate, not V8 heap measurement: UTF-16 key + entry + event objects.
    let bytes = 256;
    for (const map of [this.aggregates, this.clients])
      for (const [key, entry] of map) {
        bytes += 256 + key.length * 2;
        if (entry.state.algorithm === "sliding-window") bytes += 64 * entry.state.events.length;
      }
    return bytes;
  }
}
