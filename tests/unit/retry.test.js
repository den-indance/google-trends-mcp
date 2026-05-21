import { describe, test, expect, vi } from 'vitest';
import { createTrendsClient } from '../../trends-client.js';

function makeProxy() {
  return { agent: { tag: 'proxy-agent' }, onFail: vi.fn() };
}

function setup({ proxies = [makeProxy(), makeProxy(), makeProxy()] } = {}) {
  let i = 0;
  const getAgent = vi.fn(() => proxies[i++] ?? null);
  const https = { globalAgent: { tag: 'original' } };
  const client = createTrendsClient({ getAgent, https, maxAttempts: 3 });
  return { client, getAgent, https, proxies };
}

describe('withProxy retry semantics', () => {
  test('success on first attempt — no retries', async () => {
    const { client, getAgent } = setup();
    const fn = vi.fn(async () => '{"ok":true}');
    const result = await client._withProxy(fn)('arg1');
    expect(result).toBe('{"ok":true}');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('arg1');
    expect(getAgent).toHaveBeenCalledTimes(1);
  });

  test('HTML response triggers retry, success on 2nd', async () => {
    const { client, getAgent, proxies } = setup();
    let call = 0;
    const fn = vi.fn(async () => (++call === 1 ? '<html>blocked</html>' : '{"ok":true}'));
    const result = await client._withProxy(fn)();
    expect(result).toBe('{"ok":true}');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(proxies[0].onFail).toHaveBeenCalledTimes(1);
    expect(proxies[1].onFail).toHaveBeenCalledTimes(0);
    expect(getAgent).toHaveBeenCalledTimes(2);
  });

  test('exception triggers retry, success on 2nd', async () => {
    const { client, proxies } = setup();
    let call = 0;
    const fn = vi.fn(async () => {
      if (++call === 1) throw new Error('network fail');
      return '{"ok":true}';
    });
    await expect(client._withProxy(fn)()).resolves.toBe('{"ok":true}');
    expect(proxies[0].onFail).toHaveBeenCalledTimes(1);
    expect(proxies[1].onFail).toHaveBeenCalledTimes(0);
  });

  test('3 HTML in a row → throws with HTML message', async () => {
    const { client, proxies } = setup();
    const fn = vi.fn(async () => '<html>blocked</html>');
    await expect(client._withProxy(fn)()).rejects.toThrow(/HTML/);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(proxies[0].onFail).toHaveBeenCalledTimes(1);
    expect(proxies[1].onFail).toHaveBeenCalledTimes(1);
    expect(proxies[2].onFail).toHaveBeenCalledTimes(1);
  });

  test('3 exceptions in a row → throws last error', async () => {
    const { client } = setup();
    const fn = vi.fn(async () => { throw new Error('boom'); });
    await expect(client._withProxy(fn)()).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('mixed: HTML → exception → JSON success', async () => {
    const { client, proxies } = setup();
    let call = 0;
    const fn = vi.fn(async () => {
      call++;
      if (call === 1) return '<html>';
      if (call === 2) throw new Error('transient');
      return '{"ok":1}';
    });
    await expect(client._withProxy(fn)()).resolves.toBe('{"ok":1}');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(proxies[0].onFail).toHaveBeenCalledTimes(1);
    expect(proxies[1].onFail).toHaveBeenCalledTimes(1);
    expect(proxies[2].onFail).toHaveBeenCalledTimes(0);
  });

  test('getAgent returns null → fn still runs, no onFail anywhere', async () => {
    const { client, getAgent } = setup({ proxies: [null, null, null] });
    const fn = vi.fn(async () => '{"ok":1}');
    await expect(client._withProxy(fn)()).resolves.toBe('{"ok":1}');
    expect(getAgent).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('https.globalAgent restored after each attempt (even on full failure)', async () => {
    const original = { tag: 'original' };
    const https = { globalAgent: original };
    const proxies = [makeProxy(), makeProxy(), makeProxy()];
    let i = 0;
    const getAgent = () => proxies[i++] ?? null;
    const client = createTrendsClient({ getAgent, https, maxAttempts: 3 });
    const fn = vi.fn(async () => '<html>');
    await expect(client._withProxy(fn)()).rejects.toThrow();
    expect(https.globalAgent).toBe(original);
  });
});
