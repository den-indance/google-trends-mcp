import { describe, test, expect, afterEach } from 'vitest';
import { spawnMcp, initialized } from './_helpers.js';

const RUN = process.env.RUN_E2E === '1';

describe.skipIf(!RUN)('MCP protocol e2e', () => {
  let mcp;
  afterEach(async () => { if (mcp) await mcp.close(); mcp = null; });

  test('initialize handshake returns serverInfo with name=google-trends', async () => {
    mcp = spawnMcp({ PROXIES_ENABLED: 'false' });
    const resp = await mcp.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e-test', version: '1.0.0' },
    });
    expect(resp.error).toBeUndefined();
    expect(resp.result?.serverInfo?.name).toBe('google-trends');
  });

  test('tools/list returns 5 tools with expected names', async () => {
    mcp = await initialized({ PROXIES_ENABLED: 'false' });
    const resp = await mcp.send('tools/list', {});
    const names = resp.result.tools.map(t => t.name).sort();
    expect(names).toEqual([
      'compare_keywords',
      'get_interest_by_region',
      'get_related_queries',
      'proxy_refresh',
      'proxy_status',
    ]);
  });

  test('tools/call proxy_status without env returns disabled/direct message', async () => {
    mcp = await initialized({ PROXIES_ENABLED: 'false' });
    const resp = await mcp.send('tools/call', { name: 'proxy_status', arguments: {} });
    const text = resp.result.content[0].text;
    expect(text).toMatch(/disabled|direct/i);
  });

  test.skipIf(!process.env.INTEGRATION_PROXY_URL)(
    'tools/call compare_keywords through real proxy returns JSON timeline',
    async () => {
      mcp = await initialized({ PROXY_URL: process.env.INTEGRATION_PROXY_URL });
      const resp = await mcp.send('tools/call', {
        name: 'compare_keywords',
        arguments: { keywords: ['claude ai'] },
      });
      const text = resp.result.content[0].text;
      expect(() => JSON.parse(text)).not.toThrow();
      const data = JSON.parse(text);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    }
  );
});
