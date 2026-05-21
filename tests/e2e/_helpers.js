import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(__dir, '../../server.js');

export function spawnMcp(env = {}) {
  const proc = spawn('node', [SERVER_PATH], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, ...env },
  });

  const pending = new Map();
  let nextId = 1;
  let buf = '';

  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        }
      } catch { /* ignore non-JSON */ }
    }
  });

  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP request ${method} timed out`));
      }, 15_000);
      pending.set(id, (msg) => {
        clearTimeout(timeout);
        resolve(msg);
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  async function close() {
    proc.kill();
    return new Promise((r) => proc.on('exit', r));
  }

  return { send, close, proc };
}

const INIT_PARAMS = {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'e2e-test', version: '1.0.0' },
};

export async function initialized(env) {
  const mcp = spawnMcp(env);
  await mcp.send('initialize', INIT_PARAMS);
  return mcp;
}
