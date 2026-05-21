import { describe, test, expect } from 'vitest';
import { createTrendsClient, looksLikeHtml, MAX_ATTEMPTS } from '../../trends-client.js';

describe('trends-client module shape', () => {
  test('exports createTrendsClient factory', () => {
    expect(typeof createTrendsClient).toBe('function');
  });
  test('exports looksLikeHtml predicate', () => {
    expect(typeof looksLikeHtml).toBe('function');
  });
  test('exports MAX_ATTEMPTS constant', () => {
    expect(MAX_ATTEMPTS).toBe(3);
  });
});
