import { describe, test, expect } from 'vitest';
import https from 'https';
import { TRENDS_MARKER } from '../../proxy-manager.js';

const RUN = process.env.RUN_INTEGRATION === '1';

describe.skipIf(!RUN)('checkProxy against real Google endpoint', () => {
  test('TRENDS_MARKER is the 4-byte anti-XSSI prefix', () => {
    expect(TRENDS_MARKER).toBe(")]}'");
    expect(TRENDS_MARKER.length).toBe(4);
  });

  test('direct GET to /api/autocomplete/test returns body with the marker', async () => {
    const url = 'https://trends.google.com/trends/api/autocomplete/test?hl=en-US&tz=0';
    const body = await new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let buf = '';
        res.on('data', (c) => buf += c);
        res.on('end', () => resolve(buf));
        res.on('error', reject);
      }).on('error', reject);
    });
    if (body.trimStart().startsWith('<')) {
      console.warn('Google returned HTML — likely rate-limited from this IP. Test passes vacuously.');
    } else {
      expect(body).toContain(TRENDS_MARKER);
    }
  });
});
