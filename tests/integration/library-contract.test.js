import { describe, test, expect } from 'vitest';
import googleTrends from 'google-trends-api';

const RUN = process.env.RUN_INTEGRATION === '1';

describe.skipIf(!RUN)('google-trends-api library contract', () => {
  test('interestOverTime returns a string', async () => {
    const result = await googleTrends.interestOverTime({
      keyword: 'test',
      geo: '',
      hl: 'en-US',
      timezone: 0,
    });
    expect(typeof result).toBe('string');
  });

  test('relatedQueries returns a string', async () => {
    const result = await googleTrends.relatedQueries({
      keyword: 'test',
      geo: '',
      hl: 'en-US',
    });
    expect(typeof result).toBe('string');
  });
});
