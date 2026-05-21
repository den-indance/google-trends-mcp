import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __testDir = path.dirname(fileURLToPath(import.meta.url));
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

// Подсадить ОДНОВРЕМЕННО listFile и кэш, чтобы initProxies взял всё из кэша без сетевой валидации.
async function seedCacheAndFile(listFile, proxies) {
  await fs.writeFile(listFile, proxies.join('\n') + '\n');
  const m = await loadFresh({ PROXY_LIST_FILE: listFile });
  const hash = m.hashList(proxies);
  await fs.writeFile(CACHE_FILE, JSON.stringify({
    inputHash: hash,
    lastChecked: new Date().toISOString(),
    working: proxies,
  }));
}

describe('getAgent — single mode', () => {
  beforeEach(async () => { try { await fs.unlink(CACHE_FILE); } catch {} });
  afterEach(async () => {
    try { await fs.unlink(CACHE_FILE); } catch {}
    vi.unstubAllEnvs();
  });

  test('PROXY_URL mode: getAgent always returns non-null, proxyCount=1', async () => {
    const m = await loadFresh({ PROXY_URL: 'http://x:80' });
    await m.initProxies();
    const a = m.getAgent();
    const b = m.getAgent();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(m.proxyCount()).toBe(1);
  });

  test('single mode does NOT drop proxy after fails', async () => {
    const m = await loadFresh({ PROXY_URL: 'http://x:80' });
    await m.initProxies();
    for (let i = 0; i < 10; i++) {
      const p = m.getAgent();
      expect(p).not.toBeNull();
      p.onFail();
    }
    expect(m.proxyCount()).toBe(1);
  });
});

describe('getAgent — pool mode', () => {
  let listFile;
  beforeEach(async () => {
    listFile = `/tmp/get-agent-pool-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
    await fs.writeFile(listFile, 'http://127.0.0.1:1\nhttp://127.0.0.1:2\n');
    try { await fs.unlink(CACHE_FILE); } catch {}
  });
  afterEach(async () => {
    try { await fs.unlink(listFile); } catch {}
    try { await fs.unlink(CACHE_FILE); } catch {}
    vi.unstubAllEnvs();
  });

  test('proxies drop from pool after 3 fails each', async () => {
    const proxies = ['http://10.0.0.1:80', 'http://10.0.0.2:80'];
    await seedCacheAndFile(listFile, proxies);

    const m = await loadFresh({ PROXY_LIST_FILE: listFile });
    await m.initProxies();
    expect(m.proxyCount()).toBe(2);

    // Фейлим каждый прокси 3 раза — детерминированно через Math.random stub
    const randomSpy = vi.spyOn(Math, 'random');
    // Сначала 3 фейла на индекс 0 (random=0)
    randomSpy.mockReturnValue(0);
    for (let i = 0; i < 3; i++) { const p = m.getAgent(); if (p) p.onFail(); }
    // После 3-х фейлов первый прокси отфильтруется в начале следующего getAgent
    // Теперь random=0 даст оставшийся (бывший index 1)
    randomSpy.mockReturnValue(0);
    for (let i = 0; i < 3; i++) { const p = m.getAgent(); if (p) p.onFail(); }
    // Все проксики отфильтрованы
    expect(m.getAgent()).toBeNull();
    expect(m.proxyCount()).toBe(0);

    randomSpy.mockRestore();
  });

  test('empty pool → returns null', async () => {
    const m = await loadFresh({});
    await m.initProxies();
    expect(m.getAgent()).toBeNull();
  });

  test('PROXIES_ENABLED=false → always null', async () => {
    const m = await loadFresh({ PROXIES_ENABLED: 'false', PROXY_URL: 'http://x:80' });
    await m.initProxies();
    expect(m.getAgent()).toBeNull();
    expect(m.getAgent()).toBeNull();
  });

  test('statistical: 1000 calls without onFail return non-null (pool stable)', async () => {
    const proxies = ['http://10.0.0.1:80', 'http://10.0.0.2:80', 'http://10.0.0.3:80'];
    await seedCacheAndFile(listFile, proxies);

    const m = await loadFresh({ PROXY_LIST_FILE: listFile });
    await m.initProxies();

    let nonNull = 0;
    for (let i = 0; i < 1000; i++) if (m.getAgent() !== null) nonNull++;
    expect(nonNull).toBe(1000);
  });
});
