import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveClientRoute } from './routes.js';

test('known marketing pages and app route resolve explicitly', () => {
  assert.deepEqual(resolveClientRoute('/'), { kind: 'marketing', page: 'home' });
  assert.deepEqual(resolveClientRoute('/review/'), { kind: 'marketing', page: 'review' });
  assert.deepEqual(resolveClientRoute('/method'), { kind: 'marketing', page: 'method' });
  assert.deepEqual(resolveClientRoute('/guardrails'), { kind: 'marketing', page: 'guardrails' });
  assert.deepEqual(resolveClientRoute('/app/'), { kind: 'app' });
});

test('unknown paths resolve to a not-found page, including nested app paths', () => {
  assert.deepEqual(resolveClientRoute('/not-built-yet'), { kind: 'marketing', page: 'notFound' });
  assert.deepEqual(resolveClientRoute('/app/settings'), { kind: 'marketing', page: 'notFound' });
});
