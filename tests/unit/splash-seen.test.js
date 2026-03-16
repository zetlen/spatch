import { afterEach, describe, expect, test } from 'bun:test';

// Stub sessionStorage for bun test environment
let store = {};
const fakeSessionStorage = {
  getItem: (key) => store[key] ?? null,
  setItem: (key, value) => {
    store[key] = value;
  },
  removeItem: (key) => {
    delete store[key];
  },
  clear: () => {
    store = {};
  },
};

if (typeof globalThis.sessionStorage === 'undefined') {
  globalThis.sessionStorage = fakeSessionStorage;
}

import { _getSeenList, _markSeen, _isSeen } from '../../js/splash.ts';

afterEach(() => {
  sessionStorage.clear();
});

describe('seen storage', () => {
  test('empty by default', () => {
    expect(_getSeenList()).toEqual([]);
    expect(_isSeen('/s/abc')).toBe(false);
  });

  test('markSeen adds pathname', () => {
    _markSeen('/s/abc');
    expect(_isSeen('/s/abc')).toBe(true);
    expect(_getSeenList()).toEqual(['/s/abc']);
  });

  test('markSeen is idempotent', () => {
    _markSeen('/s/abc');
    _markSeen('/s/abc');
    expect(_getSeenList()).toEqual(['/s/abc']);
  });

  test('multiple pathnames stored in order', () => {
    _markSeen('/s/aaa');
    _markSeen('/s/bbb');
    _markSeen('/s/ccc');
    expect(_getSeenList()).toEqual(['/s/aaa', '/s/bbb', '/s/ccc']);
  });

  test('caps at 100 entries, shifts oldest', () => {
    for (let i = 0; i < 105; i++) {
      _markSeen(`/s/item${i}`);
    }
    const list = _getSeenList();
    expect(list.length).toBe(100);
    // First 5 should have been shifted off
    expect(list[0]).toBe('/s/item5');
    expect(list[99]).toBe('/s/item104');
    expect(_isSeen('/s/item0')).toBe(false);
    expect(_isSeen('/s/item4')).toBe(false);
    expect(_isSeen('/s/item5')).toBe(true);
    expect(_isSeen('/s/item104')).toBe(true);
  });

  test('handles corrupted sessionStorage gracefully', () => {
    sessionStorage.setItem('spatch-seen', 'not valid json');
    expect(_getSeenList()).toEqual([]);
    expect(_isSeen('/s/abc')).toBe(false);

    // markSeen should still work after corruption
    _markSeen('/s/abc');
    expect(_isSeen('/s/abc')).toBe(true);
  });

  test('handles non-array sessionStorage value', () => {
    sessionStorage.setItem('spatch-seen', '"a string"');
    expect(_getSeenList()).toEqual([]);
  });
});
