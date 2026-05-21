import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __testDir = path.dirname(fileURLToPath(import.meta.url));
// Реальный код: CACHE_FILE = path.join(__dir, "proxies.json") где __dir — директория proxy-manager.js.
// tests/unit/ → ../../ → корень google-trends-mcp/, рядом с proxy-manager.js
const CACHE_FILE = path.resolve(__testDir, '../../proxies.json');

async function loadFresh(env) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const k of ['PROXY_URL', 'PROXY_LIST', 'PROXY_LIST_FILE', 'PROXIES_ENABLED']) {
    vi.stubEnv(k, '');
  }
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return await import('../../proxy-manager.js');
}

describe('proxy cache invalidation', () => {
  let tmpListFile;

  beforeEach(async () => {
    tmpListFile = path.join(os.tmpdir(), `proxy-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    await fs.writeFile(tmpListFile, 'http://127.0.0.1:1\nhttp://127.0.0.1:2\n');
    try { await fs.unlink(CACHE_FILE); } catch {}
  });

  afterEach(async () => {
    try { await fs.unlink(tmpListFile); } catch {}
    try { await fs.unlink(CACHE_FILE); } catch {}
    vi.unstubAllEnvs();
  });

  test('hashList is deterministic and order-independent', async () => {
    const m = await loadFresh({});
    expect(m.hashList(['http://b', 'http://a'])).toBe(m.hashList(['http://a', 'http://b']));
    expect(m.hashList(['http://a'])).not.toBe(m.hashList(['http://b']));
    expect(m.hashList([])).toMatch(/^[a-f0-9]{40}$/);
  });

  test('fresh cache with matching hash is reused (no re-validation)', async () => {
    const fakeProxies = ['http://127.0.0.1:1', 'http://127.0.0.1:2'];
    const m1 = await loadFresh({ PROXY_LIST_FILE: tmpListFile });
    const hash = m1.hashList(fakeProxies);
    await fs.writeFile(CACHE_FILE, JSON.stringify({
      inputHash: hash,
      lastChecked: new Date().toISOString(),
      working: fakeProxies,
    }));

    const m2 = await loadFresh({ PROXY_LIST_FILE: tmpListFile });
    const t0 = Date.now();
    await m2.initProxies();
    const elapsed = Date.now() - t0;

    expect(m2.proxyStatus().working).toBe(2);
    // Cache hit должен быть мгновенным — без TCP-попыток на 127.0.0.1:1/2
    expect(elapsed).toBeLessThan(500);
  });

  test('cache with mismatched hash is ignored (forces re-validation)', async () => {
    await fs.writeFile(CACHE_FILE, JSON.stringify({
      inputHash: 'STALE_HASH_VALUE',
      lastChecked: new Date().toISOString(),
      working: ['http://stale-proxy:80'],
    }));
    const m = await loadFresh({ PROXY_LIST_FILE: tmpListFile });
    await m.initProxies();
    // Stale кэш должен быть выброшен, валидация даёт 0 рабочих (127.0.0.1:1/2 — refuse)
    expect(m.proxyStatus().working).toBe(0);
  });

  test('saveCache via forceRefresh writes correct structure', async () => {
    const m = await loadFresh({ PROXY_LIST_FILE: tmpListFile });
    await m.forceRefresh();
    const raw = await fs.readFile(CACHE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    expect(data).toHaveProperty('inputHash');
    expect(data.inputHash).toMatch(/^[a-f0-9]{40}$/);
    expect(data).toHaveProperty('lastChecked');
    expect(data).toHaveProperty('working');
    expect(Array.isArray(data.working)).toBe(true);
  });
});
