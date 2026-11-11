import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadCrowd, setCrowdLevel } from './crowd-api.js';
import { getSupabase } from './supabase.js';

vi.mock('./supabase.js', () => ({ getSupabase: vi.fn() }));

const crowd = { level: 'moderate', updatedAt: '2026-11-11T14:00:00Z' };
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  getSupabase.mockReturnValue({ auth: {
    getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'staff-token' } } }),
  } });
  vi.stubGlobal('fetch', vi.fn(async () => response(crowd)));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('loads the public crowd level without browser caching', async () => {
  await expect(loadCrowd()).resolves.toEqual(crowd);
  expect(fetch).toHaveBeenCalledWith('/api/crowd', { signal: undefined, cache: 'no-store' });
});

it('sends a staff choice with the login token', async () => {
  await expect(setCrowdLevel('busy')).resolves.toEqual({ crowd });
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('/api/crowd');
  expect(options.method).toBe('PATCH');
  expect(options.headers.Authorization).toBe('Bearer staff-token');
  expect(JSON.parse(options.body)).toEqual({ level: 'busy' });
});

it('rejects unknown choices before calling the API', async () => {
  await expect(setCrowdLevel('packed')).rejects.toThrow('Choose a valid crowd level.');
  expect(fetch).not.toHaveBeenCalled();
});
