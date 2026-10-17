import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiRequestLimiter } from './api-rate-limit.js';

test('API request limiter rejects bursts and resets after the window', () => {
  const limiter = new ApiRequestLimiter(2, 1_000);

  assert.deepEqual(limiter.consume('loopback', 10_000), { allowed: true, retryAfterSeconds: 0 });
  assert.deepEqual(limiter.consume('loopback', 10_200), { allowed: true, retryAfterSeconds: 0 });
  assert.deepEqual(limiter.consume('loopback', 10_500), { allowed: false, retryAfterSeconds: 1 });
  assert.deepEqual(limiter.consume('loopback', 11_000), { allowed: true, retryAfterSeconds: 0 });
});

test('API request limiter bounds tracked client keys', () => {
  const limiter = new ApiRequestLimiter(2, 1_000, 1);

  assert.equal(limiter.consume('first', 10_000).allowed, true);
  assert.deepEqual(limiter.consume('second', 10_100), { allowed: false, retryAfterSeconds: 60 });
  assert.equal(limiter.consume('second', 11_000).allowed, true);
});
