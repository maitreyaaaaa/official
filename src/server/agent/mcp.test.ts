import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import test from 'node:test';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server';

interface RpcReply {
  id: number;
  result?: unknown;
  error?: unknown;
}

interface McpTool {
  name: string;
  annotations?: { readOnlyHint?: boolean };
}

function startMcpServer(enableWrites: boolean) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'development',
    SEED_FIXTURE: enableWrites ? 'true' : 'false',
    ENABLE_DEMO_WRITES: enableWrites ? 'true' : 'false',
    FALKORDB_GRAPH: 'official',
    FALKORDB_HOST: '127.0.0.1',
    FALKORDB_TLS: 'false',
    OPENAI_API_KEY: '',
    OPENAI_MODEL: '',
  };
  delete env.FALKORDB_USERNAME;
  delete env.FALKORDB_PASSWORD;

  const child = spawn(process.execPath, [
    resolve('node_modules/tsx/dist/cli.mjs'),
    resolve('src/server/agent/mcp.ts'),
  ], { cwd: process.cwd(), env, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map<number, {
    resolve: (reply: RpcReply) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();

  lines.on('line', (line) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof message !== 'object' || message === null || !('id' in message)
      || typeof message.id !== 'number') return;
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    request.resolve(message as RpcReply);
  });

  child.once('error', (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  });
  child.once('exit', (code) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(`MCP server exited before replying (code ${code}).`));
    }
    pending.clear();
  });

  return {
    request(id: number, method: string, params: unknown): Promise<RpcReply> {
      return new Promise((resolveReply, rejectReply) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectReply(new Error(`Timed out waiting for MCP ${method}.`));
        }, 20000);
        pending.set(id, { resolve: resolveReply, reject: rejectReply, timer });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });
    },
    notify(method: string, params: unknown): void {
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    async close(): Promise<void> {
      const exited = child.exitCode !== null
        ? Promise.resolve()
        : once(child, 'exit').then(() => undefined);
      child.stdin.end();
      const timeout = setTimeout(() => child.kill(), 2000);
      timeout.unref();
      await exited;
      clearTimeout(timeout);
      lines.close();
    },
  };
}

async function listTools(enableWrites: boolean): Promise<McpTool[]> {
  const server = startMcpServer(enableWrites);
  try {
    const initialized = await server.request(1, 'initialize', {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'official-audit', version: '1.0.0' },
    });
    assert.equal(initialized.error, undefined);
    const initializeResult = initialized.result as { protocolVersion?: string };
    assert.equal(initializeResult.protocolVersion, LATEST_PROTOCOL_VERSION);
    server.notify('notifications/initialized', {});

    const response = await server.request(2, 'tools/list', {});
    assert.equal(response.error, undefined);
    return (response.result as { tools: McpTool[] }).tools;
  } finally {
    await server.close();
  }
}

test('MCP advertises only read-only tools when local writes are disabled', { timeout: 30000 }, async () => {
  const tools = await listTools(false);
  assert.equal(tools.some((tool) => tool.name === 'propose_draft_action'), false);
  assert.ok(tools.length > 0);
  assert.ok(tools.every((tool) => tool.annotations?.readOnlyHint === true));
});

test('MCP marks state-changing tools when fixture and local writes are enabled', { timeout: 30000 }, async () => {
  const tools = await listTools(true);
  assert.ok(tools.some((tool) => tool.name === 'propose_draft_action'
    && tool.annotations?.readOnlyHint === false));
  assert.ok(tools.some((tool) => tool.name === 'check_campaign'
    && tool.annotations?.readOnlyHint === false));
  assert.ok(tools.some((tool) => tool.name === 'compare_checks'
    && tool.annotations?.readOnlyHint === true));
});
