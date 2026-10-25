import assert from "node:assert/strict";
import { test } from "node:test";
import { SlidingWindowLogAlgorithm } from "../src/algorithms/sliding-window-log";

const algorithm = new SlidingWindowLogAlgorithm();
const policy = { algorithm: "sliding-window" as const, capacity: 10, windowSizeSeconds: 60 };

test("enforces the exact rolling boundary", () => {
  const state = algorithm.preview(policy, undefined, 10, 0).commit();
  assert.equal(algorithm.preview(policy, state, 1, 59_999).allowed, false);
  assert.equal(algorithm.preview(policy, state, 1, 60_000).remaining, 9);
  assert.equal(algorithm.canForget(policy, state, 59_999), false);
  assert.equal(algorithm.canForget(policy, state, 60_000), true);
});

test("retry waits for enough cost to expire, not just the oldest event", () => {
  let state = algorithm.preview(policy, undefined, 3, 0).commit();
  state = algorithm.preview(policy, state, 7, 10_000).commit();
  const denied = algorithm.preview(policy, state, 4, 20_000);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 50_000);
  assert.throws(() => denied.commit());
});

test("preview does not append or expire events in stored state", () => {
  const state = algorithm.preview(policy, undefined, 3, 0).commit();
  algorithm.preview(policy, state, 7, 60_000);
  assert.equal(algorithm.preview(policy, state, 8, 1).allowed, false);
  assert.equal(algorithm.preview(policy, state, 7, 1).allowed, true);
});

test("bounds retained queue storage under repeated expiration", () => {
  let state = algorithm.preview(policy, undefined, 1, 0).commit();
  for (let time = 1; time <= 1_000; time++) {
    state = algorithm.preview(policy, state, 1, time * 60_000).commit();
  }
  assert.equal(state.algorithm, "sliding-window");
  if (state.algorithm === "sliding-window") assert.ok(state.events.length <= 2 * policy.capacity);
});
