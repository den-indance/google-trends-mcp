import { describe, test, expect } from 'vitest';
import { looksLikeHtml } from '../../trends-client.js';

describe('looksLikeHtml', () => {
  test('returns true for <html prefix', () => {
    expect(looksLikeHtml('<html>blocked</html>')).toBe(true);
  });
  test('returns true after trim', () => {
    expect(looksLikeHtml('   <html>...')).toBe(true);
  });
  test('returns true for any < prefix (e.g. Google 429 page)', () => {
    expect(looksLikeHtml('<!DOCTYPE html>')).toBe(true);
  });
  test("returns false for valid JSON with )]}\\' prefix", () => {
    expect(looksLikeHtml(")]}',\n{\"default\":{}}")).toBe(false);
  });
  test('returns false for non-string inputs', () => {
    expect(looksLikeHtml(null)).toBe(false);
    expect(looksLikeHtml(undefined)).toBe(false);
    expect(looksLikeHtml({})).toBe(false);
    expect(looksLikeHtml(42)).toBe(false);
  });
});
