import type { AlgorithmPolicy, QuotaState, SlidingWindowPolicy, SlidingWindowState } from '../models';
import type { Algorithm, QuotaPreview } from './algorithm';

export class SlidingWindowLogAlgorithm implements Algorithm {
  preview(policy: AlgorithmPolicy, state: QuotaState | undefined,
    cost: number, nowMs: number): QuotaPreview {
    this.validate(policy, state, nowMs);
    if (!Number.isSafeInteger(cost) || cost <= 0 || cost > policy.capacity) {
      throw new RangeError('Cost must be a positive integer no greater than capacity');
    }
    const log = state as SlidingWindowState | undefined;
    const events = log?.events ?? [];
    let head = log?.head ?? 0;
    let total = log?.totalCost ?? 0;
    const windowMs = policy.windowSizeSeconds * 1000;
    while (head < events.length && events[head]!.atMs <= nowMs - windowMs) {
      total -= events[head++]!.cost;
    }
    const allowed = total + cost <= policy.capacity;
    let retryAfterMs: number | undefined;
    if (!allowed) {
      let remainingCost = total;
      for (let index = head; index < events.length; index++) {
        remainingCost -= events[index]!.cost;
        if (remainingCost + cost <= policy.capacity) {
          retryAfterMs = events[index]!.atMs + windowMs - nowMs;
          break;
        }
      }
    }
    let committed = false;
    return {
      allowed,
      remaining: policy.capacity - total - (allowed ? cost : 0),
      fullResetAfterMs: allowed ? windowMs : events[events.length - 1]!.atMs + windowMs - nowMs,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      commit: (): SlidingWindowState => {
        if (!allowed || committed) throw new Error('Preview cannot be committed');
        committed = true;
        // Compact only when at least half the backing array is expired.
        const compact = head > 0 && head * 2 >= events.length;
        const retained = compact ? events.slice(head) : events;
        retained.push({ atMs: nowMs, cost });
        return {
          algorithm: 'sliding-window', events: retained,
          head: compact ? 0 : head, totalCost: total + cost,
        };
      },
    };
  }

  canForget(policy: AlgorithmPolicy, state: QuotaState, nowMs: number): boolean {
    this.validate(policy, state, nowMs);
    const events = (state as SlidingWindowState).events;
    return events.length === 0 || events[events.length - 1]!.atMs <= nowMs - policy.windowSizeSeconds * 1000;
  }

  private validate(policy: AlgorithmPolicy, state: QuotaState | undefined,
    nowMs: number): asserts policy is SlidingWindowPolicy {
    if (policy.algorithm !== 'sliding-window' || (state && state.algorithm !== 'sliding-window')) {
      throw new TypeError('Incorrect policy or state algorithm');
    }
    if (!Number.isSafeInteger(policy.capacity) || policy.capacity <= 0 ||
        !Number.isFinite(policy.windowSizeSeconds) || policy.windowSizeSeconds <= 0 ||
        !Number.isFinite(policy.windowSizeSeconds * 1000)) {
      throw new RangeError('Capacity and window must be positive and finite');
    }
    const last = state?.events.at(-1)?.atMs ?? 0;
    if (!Number.isFinite(nowMs) || nowMs < last) throw new RangeError('Time must be monotonic');
  }
}
