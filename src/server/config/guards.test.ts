import assert from 'node:assert/strict';
import test from 'node:test';
import { canServeLocalApp } from './guards.js';

test('local app serving requires development mode and a loopback client', () => {
  assert.equal(canServeLocalApp({ nodeEnv: 'development' }, { remoteAddress: '127.0.0.1', host: '127.0.0.1:3001' }), true);
  assert.equal(canServeLocalApp({ nodeEnv: 'development' }, { remoteAddress: '::1', host: '[::1]:3001' }), true);
  assert.equal(canServeLocalApp({ nodeEnv: 'development' }, { remoteAddress: '::ffff:127.0.0.1', host: '[::ffff:127.0.0.1]:3001' }), true);
  assert.equal(canServeLocalApp({ nodeEnv: 'development' }, { remoteAddress: '::ffff:127.0.0.1', host: 'localhost:3001' }), true);
  assert.equal(canServeLocalApp({ nodeEnv: 'production' }, { remoteAddress: '127.0.0.1', host: 'localhost:3001' }), false);
  assert.equal(canServeLocalApp({ nodeEnv: undefined }, { remoteAddress: '127.0.0.1', host: 'localhost:3001' }), false);
  assert.equal(canServeLocalApp({ nodeEnv: 'development' }, { remoteAddress: '203.0.113.10', host: 'localhost:3001' }), false);
  assert.equal(canServeLocalApp({ nodeEnv: 'development' }, { remoteAddress: '127.0.0.1', host: 'attacker.example:3001' }), false);
  assert.equal(canServeLocalApp({ nodeEnv: 'development' }, { remoteAddress: '127.0.0.1', host: 'localhost.attacker.example:3001' }), false);
  assert.equal(canServeLocalApp({ nodeEnv: 'development' }, { remoteAddress: '127.0.0.1', host: 'attacker.example@localhost:3001' }), false);
  assert.equal(canServeLocalApp({ nodeEnv: 'development' }, { remoteAddress: '127.0.0.1', host: '@localhost:3001' }), false);
  assert.equal(canServeLocalApp({ nodeEnv: 'development' }, { remoteAddress: '127.0.0.1' }), false);
  assert.equal(canServeLocalApp({ nodeEnv: 'development' }, {}), false);
});
