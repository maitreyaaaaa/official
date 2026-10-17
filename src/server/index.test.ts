import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import test, { after, before } from 'node:test';
import { app } from './index.js';

const envNames = [
  'NODE_ENV', 'PORT', 'SEED_FIXTURE', 'ENABLE_DEMO_WRITES', 'FALKORDB_GRAPH',
  'FALKORDB_HOST', 'FALKORDB_PORT', 'FALKORDB_TLS', 'FALKORDB_USERNAME', 'FALKORDB_PASSWORD',
  'OPENAI_API_KEY', 'OPENAI_MODEL',
] as const;
const originalEnvironment = new Map(envNames.map((name) => [name, process.env[name]]));
const originalGraphProvider = app.locals.graphProvider;

let server: ReturnType<typeof app.listen>;
let baseUrl: string;
let localOrigin: string;
let graphAccessCount = 0;

function requestWithHost(path: string, host: string): Promise<{ statusCode: number | undefined; body: string }> {
  const url = new URL(`${baseUrl}${path}`);
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers: { host } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode, body }));
    });
    request.on('error', reject);
    request.end();
  });
}

function requestWithoutContentType(path: string, body: string): Promise<{ statusCode: number | undefined; body: string }> {
  const url = new URL(`${baseUrl}${path}`);
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: 'POST', headers: { origin: localOrigin } }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { responseBody += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode, body: responseBody }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

before(async () => {
  process.env.NODE_ENV = 'development';
  process.env.SEED_FIXTURE = 'true';
  process.env.ENABLE_DEMO_WRITES = 'true';
  process.env.FALKORDB_GRAPH = 'official';
  process.env.FALKORDB_HOST = 'localhost';
  process.env.FALKORDB_TLS = 'false';
  delete process.env.FALKORDB_PORT;
  delete process.env.FALKORDB_USERNAME;
  delete process.env.FALKORDB_PASSWORD;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  app.locals.graphProvider = async () => {
    graphAccessCount += 1;
    throw new Error('Route guard tests must not access a graph.');
  };

  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const port = (address as AddressInfo).port;
  process.env.PORT = String(port);
  baseUrl = `http://127.0.0.1:${port}`;
  localOrigin = baseUrl;
});

after(async () => {
  if (server) await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  app.locals.graphProvider = originalGraphProvider;
  for (const [name, value] of originalEnvironment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test('review route rejects campaign IDs outside the fictional fixture before graph access', async () => {
  const response = await fetch(`${baseUrl}/api/campaigns/another-campaign/review`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Campaign not found in the local fictional campaign.' });
  assert.equal(graphAccessCount, 0);
});

test('unknown API routes return a JSON 404 without graph access', async () => {
  const response = await fetch(`${baseUrl}/api/not-a-real-route`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'API route not found.' });
  assert.equal(graphAccessCount, 0);
});

test('rollout scenario requires an explicit access state before graph access', async () => {
  const response = await fetch(`${baseUrl}/api/campaigns/campaign-csv-launch/demo-rollout`, {
    method: 'POST',
    headers: { Origin: localOrigin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Choose whether access should include all accounts.' });
  assert.equal(graphAccessCount, 0);
});

test('local app rejects an attacker-controlled Host header before graph access', async () => {
  const response = await requestWithHost('/api/health', 'attacker.example');
  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { error: 'The reviewer demo is not enabled for this deployment.' });
  assert.equal(graphAccessCount, 0);
});

test('request body limits and errors apply across content types', async () => {
  process.env.ENABLE_DEMO_WRITES = 'false';
  const bodylessPost = await fetch(`${baseUrl}/api/campaigns/campaign-csv-launch/check`, {
    method: 'POST',
    headers: { Origin: localOrigin },
  });
  assert.equal(bodylessPost.status, 404);
  process.env.ENABLE_DEMO_WRITES = 'true';

  const oversizedText = await fetch(`${baseUrl}/api/campaigns/campaign-csv-launch/check`, {
    method: 'POST',
    headers: { Origin: localOrigin, 'Content-Type': 'text/plain' },
    body: 'x'.repeat(9000),
  });
  assert.equal(oversizedText.status, 413);
  assert.deepEqual(await oversizedText.json(), { error: 'Request body is too large.' });

  const oversizedJson = await fetch(`${baseUrl}/api/assistant`, {
    method: 'POST',
    headers: { Origin: localOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'x'.repeat(9000) }),
  });
  assert.equal(oversizedJson.status, 413);
  assert.deepEqual(await oversizedJson.json(), { error: 'Request body is too large.' });

  const unsupported = await fetch(`${baseUrl}/api/campaigns/campaign-csv-launch/check`, {
    method: 'POST',
    headers: { Origin: localOrigin, 'Content-Type': 'text/plain' },
    body: 'x',
  });
  assert.equal(unsupported.status, 415);
  assert.deepEqual(await unsupported.json(), { error: 'Request content type or encoding is unsupported.' });

  const missingContentType = await requestWithoutContentType('/api/campaigns/campaign-csv-launch/check', 'x');
  assert.equal(missingContentType.statusCode, 415);
  assert.deepEqual(JSON.parse(missingContentType.body), { error: 'Request content type or encoding is unsupported.' });

  const malformedJson = await fetch(`${baseUrl}/api/assistant`, {
    method: 'POST',
    headers: { Origin: localOrigin, 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(malformedJson.status, 400);
  assert.deepEqual(await malformedJson.json(), { error: 'Request body is invalid.' });
  assert.equal(graphAccessCount, 0);
});

test('campaign mutations fail closed for cross-origin callers before graph access', async () => {
  const requests: Array<[string, string, unknown?]> = [
    ['POST', '/api/assistant', { message: 'Explain the current review.' }],
    ['POST', '/api/campaigns/campaign-csv-launch/check', {}],
    ['POST', '/api/campaigns/campaign-csv-launch/drafts/draft-csv-all/proposals', {}],
    ['POST', '/api/campaigns/campaign-csv-launch/proposals/00000000-0000-4000-8000-000000000001/approve', {}],
    ['POST', '/api/campaigns/campaign-csv-launch/proposals/00000000-0000-4000-8000-000000000001/reject', {}],
    ['POST', '/api/campaigns/campaign-csv-launch/drafts/draft-csv-all/resume', {}],
    ['POST', '/api/campaigns/campaign-csv-launch/fixture', {}],
    ['POST', '/api/campaigns/campaign-csv-launch/demo-rollout', {}],
    ['POST', '/api/campaigns/campaign-csv-launch/demo-test-state', { available: false }],
  ];

  for (const [method, path, body] of requests) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Origin: 'http://untrusted.example', 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    assert.equal(response.status, 404, `${method} ${path} should reject before graph access`);
  }
  assert.equal(graphAccessCount, 0);
});

test('campaign mutations remain disabled until the local write opt-in is enabled', async () => {
  process.env.ENABLE_DEMO_WRITES = 'false';
  const response = await fetch(`${baseUrl}/api/campaigns/campaign-csv-launch/check`, {
    method: 'POST',
    headers: { Origin: localOrigin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 404);
  assert.equal(graphAccessCount, 0);
});

test('imported app refuses production requests before graph access', async () => {
  process.env.NODE_ENV = 'production';
  try {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'The reviewer demo is not enabled for this deployment.' });
    assert.equal(graphAccessCount, 0);
  } finally {
    process.env.NODE_ENV = 'development';
  }
});
