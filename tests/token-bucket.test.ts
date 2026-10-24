import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TokenBucketAlgorithm } from '../src/algorithms/token-bucket';
import { FakeClock } from './helpers/fake-clock';

const algorithm = new TokenBucketAlgorithm();
const policy = { algorithm: 'token-bucket' as const, capacity: 100, refillRatePerSecond: 10 };

test('consumes capacity and denies until enough tokens refill', () => {
  const first = algorithm.preview(policy, undefined, 100, 0);
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 0);
  assert.equal(first.fullResetAfterMs, 10_000);
  const state = first.commit();
  const denied = algorithm.preview(policy, state, 1, 0);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 100);
  assert.throws(() => denied.commit());
  assert.equal(algorithm.preview(policy, state, 1, 99).allowed, false);
  assert.equal(algorithm.preview(policy, state, 1, 100).allowed, true);
});

test('preview cannot spend tokens before the hierarchy commits', () => {
  const state = algorithm.preview(policy, undefined, 90, 0).commit();
  algorithm.preview(policy, state, 10, 0);
  assert.equal(algorithm.preview(policy, state, 10, 0).allowed, true);
  assert.equal(algorithm.preview(policy, state, 11, 0).allowed, false);
});

test('fractional refill survives successful consumption and caps at capacity', () => {
  let state = algorithm.preview(policy, undefined, 100, 0).commit();
  state = algorithm.preview(policy, state, 1, 150).commit();
  assert.equal(algorithm.preview(policy, state, 1, 200).allowed, true);
  assert.equal(algorithm.preview(policy, state, 1, 1_000_000).remaining, 99);
});

test('only fully recovered state is safe to forget', () => {
  const state = algorithm.preview(policy, undefined, 100, 0).commit();
  assert.equal(algorithm.canForget(policy, state, 9_999), false);
  assert.equal(algorithm.canForget(policy, state, 10_000), true);
});

test('rejects impossible costs and invalid parameters', () => {
  for (const cost of [0, -1, 0.5, NaN, Infinity, 101]) {
    assert.throws(() => algorithm.preview(policy, undefined, cost, 0));
  }
  assert.throws(() => algorithm.preview({ ...policy, refillRatePerSecond: 0 }, undefined, 1, 0));
});

test('wall-clock adjustments do not refill tokens', () => {
  const clock = new FakeClock();
  const state = algorithm.preview(policy, undefined, 100, clock.monotonicMs()).commit();
  clock.shiftWall(60_000);
  assert.equal(algorithm.preview(policy, state, 1, clock.monotonicMs()).allowed, false);
  clock.shiftWall(-120_000);
  clock.advance(100);
  assert.equal(algorithm.preview(policy, state, 1, clock.monotonicMs()).allowed, true);
});

test('preview is single-use and rejects mismatched state or backwards time', () => {
  const preview = algorithm.preview(policy, undefined, 1, 1_000);
  const state = preview.commit();
  assert.throws(() => preview.commit());
  assert.throws(() => algorithm.preview(policy, state, 1, 999));
  assert.throws(() => algorithm.preview(policy, {
    algorithm: 'sliding-window', events: [], head: 0, totalCost: 0,
  }, 1, 1_000));
});
