import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

async function loadFresh(env) {
  vi.resetModules();
  vi.unstubAllEnvs();
  // Сначала зачищаем все потенциальные env-vars из родительского shell
  for (const k of ['PROXY_URL', 'PROXY_LIST', 'PROXY_LIST_FILE', 'PROXIES_ENABLED']) {
    vi.stubEnv(k, '');
  }
  // Затем выставляем нужные
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return await import('../../proxy-manager.js');
}

describe('proxy source priority', () => {
  let tmpFile;

  beforeEach(async () => {
    tmpFile = path.join(os.tmpdir(), `proxy-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    await fs.writeFile(tmpFile, 'http://file-proxy:80\n');
  });

  afterEach(async () => {
    try { await fs.unlink(tmpFile); } catch {}
    vi.unstubAllEnvs();
  });

  test('PROXY_URL alone → source=single, working=1', async () => {
    const m = await loadFresh({ PROXY_URL: 'http://x:80' });
    await m.initProxies();
    const s = m.proxyStatus();
    expect(s.source).toBe('single');
    expect(s.working).toBe(1);
  });

  test('PROXY_LIST alone → source=env-list', async () => {
    const m = await loadFresh({ PROXY_LIST: 'http://127.0.0.1:1,http://127.0.0.1:2' });
    await m.initProxies();
    expect(m.proxyStatus().source).toBe('env-list');
    // working может быть 0 — TCP refuse на 127.0.0.1:1/2
  });

  test('PROXY_URL beats PROXY_LIST', async () => {
    const m = await loadFresh({
      PROXY_URL: 'http://x:80',
      PROXY_LIST: 'http://other:80',
    });
    await m.initProxies();
    expect(m.proxyStatus().source).toBe('single');
  });

  test('PROXY_LIST beats PROXY_LIST_FILE', async () => {
    const m = await loadFresh({
      PROXY_LIST: 'http://127.0.0.1:1',
      PROXY_LIST_FILE: tmpFile,
    });
    await m.initProxies();
    expect(m.proxyStatus().source).toBe('env-list');
  });

  test('PROXY_LIST_FILE alone → source=env-file', async () => {
    const m = await loadFresh({ PROXY_LIST_FILE: tmpFile });
    await m.initProxies();
    expect(m.proxyStatus().source).toBe('env-file');
  });

  test('no env vars → source=none, working=0', async () => {
    const m = await loadFresh({});
    await m.initProxies();
    const s = m.proxyStatus();
    expect(s.source).toBe('none');
    expect(s.working).toBe(0);
  });

  test('PROXIES_ENABLED=false → source=disabled, enabled:false', async () => {
    const m = await loadFresh({ PROXIES_ENABLED: 'false', PROXY_URL: 'http://x:80' });
    await m.initProxies();
    const s = m.proxyStatus();
    expect(s.source).toBe('disabled');
    expect(s.enabled).toBe(false);
  });
});
