import assert from 'node:assert/strict';
import test from 'node:test';
import { canSeedFixture, canServeDemoApp, canServeLocalApp, canWriteDemo } from './guards.js';

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

test('hosted demo mode requires explicit opt-in and an exact Vercel host', () => {
  const config = {
    nodeEnv: 'production', enablePublicDemo: 'true',
    vercelUrl: 'official-example.vercel.app', graph: 'official',
    falkordbHost: 'db.example.com', falkordbTls: 'false', allowInsecureFalkordb: 'true',
    seedFixture: 'true', enableDemoWrites: 'true',
  };
  assert.equal(canServeDemoApp(config, { host: 'official-example.vercel.app' }), true);
  assert.equal(canServeDemoApp(config, { host: 'attacker-example.vercel.app' }), false);
  assert.equal(canServeDemoApp({ ...config, enablePublicDemo: 'false' }, { host: 'official-example.vercel.app' }), false);
  assert.equal(canServeDemoApp(config, { host: 'official-example.vercel.app.attacker.test' }), false);
});

test('hosted demo mutations require the exact HTTPS same origin', () => {
  const config = {
    nodeEnv: 'production', enablePublicDemo: 'true',
    vercelUrl: 'official-example.vercel.app', graph: 'official',
    falkordbHost: 'db.example.com', falkordbTls: 'false', allowInsecureFalkordb: 'true',
    seedFixture: 'true', enableDemoWrites: 'true',
  };
  assert.equal(canWriteDemo(config, { host: 'official-example.vercel.app', origin: 'https://official-example.vercel.app' }), true);
  assert.equal(canWriteDemo(config, { host: 'official-example.vercel.app', origin: 'https://attacker.test' }), false);
  assert.equal(canWriteDemo(config, { host: 'attacker.test', origin: 'https://attacker.test' }), false);
});

test('hosted fixtures require a remote graph and insecure mode must be explicitly enabled without TLS', () => {
  const config = {
    nodeEnv: 'production', enablePublicDemo: 'true',
    vercelUrl: 'official-example.vercel.app', graph: 'official',
    falkordbHost: 'db.example.com', falkordbTls: 'false', seedFixture: 'true',
  };
  assert.equal(canSeedFixture(config), false);
  assert.equal(canSeedFixture({ ...config, allowInsecureFalkordb: 'true' }), true);
  assert.equal(canSeedFixture({ ...config, falkordbTls: 'true' }), true);
  assert.equal(canSeedFixture({ ...config, graph: 'another-graph', allowInsecureFalkordb: 'true' }), false);
});
