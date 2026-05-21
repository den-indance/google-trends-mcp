import { describe, test, expect } from 'vitest';
import { normalize } from '../../proxy-manager.js';

describe('normalize', () => {
  test('adds http:// to bare host:port', () => {
    expect(normalize('1.2.3.4:8080')).toBe('http://1.2.3.4:8080');
  });
  test('preserves explicit http:// prefix', () => {
    expect(normalize('http://1.2.3.4:8080')).toBe('http://1.2.3.4:8080');
  });
  test('preserves https:// prefix', () => {
    expect(normalize('https://proxy.example.com:443')).toBe('https://proxy.example.com:443');
  });
  test('preserves socks5:// prefix', () => {
    expect(normalize('socks5://1.2.3.4:1080')).toBe('socks5://1.2.3.4:1080');
  });
  test('trims whitespace', () => {
    expect(normalize('  http://x:80  ')).toBe('http://x:80');
  });
  test('returns null for blank line', () => {
    expect(normalize('')).toBeNull();
    expect(normalize('   ')).toBeNull();
  });
  test('returns null for # comment', () => {
    expect(normalize('# a comment')).toBeNull();
  });
});
