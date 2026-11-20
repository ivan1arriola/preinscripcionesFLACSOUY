// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function load() {
  vi.resetModules();
  return (await import('./utm')).getUtm;
}

describe('getUtm', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('guarda la URL con TTL y la conserva sin UTM', async () => {
    window.history.replaceState({}, '', '/?utm_source=ig&fbclid=abc');
    expect((await load())()).toEqual({ utm_source: 'ig', fbclid: 'abc' });
    window.history.replaceState({}, '', '/');
    expect((await load())()).toEqual({ utm_source: 'ig', fbclid: 'abc' });
  });

  it('ignora lo vencido', async () => {
    localStorage.setItem('flacso:utm', JSON.stringify({ utm: { utm_source: 'old' }, exp: Date.now() - 1 }));
    expect((await load())()).toEqual({});
  });
});
