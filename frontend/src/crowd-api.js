import { getSupabase } from './supabase.js';

export const CROWD_LEVELS = ['low', 'moderate', 'busy'];

function validCrowd(value) {
  return value && [...CROWD_LEVELS, 'not_reported'].includes(value.level) &&
    (value.updatedAt === null || typeof value.updatedAt === 'string');
}

export async function loadCrowd(signal) {
  const response = await fetch('/api/crowd', { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Crowd level is temporarily unavailable.');
  const result = await response.json().catch(() => null);
  if (!validCrowd(result)) throw new Error('Crowd level is temporarily unavailable.');
  return result;
}

async function accessToken() {
  const supabase = getSupabase();
  const { data, error } = supabase ? await supabase.auth.getSession() : { data: null };
  return error ? null : data?.session?.access_token || null;
}

export async function setCrowdLevel(level) {
  if (!CROWD_LEVELS.includes(level)) throw new Error('Choose a valid crowd level.');
  const token = await accessToken();
  if (!token) return { signInRequired: true };
  const response = await fetch('/api/crowd', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ level }),
  });
  if (response.status === 401) return { signInRequired: true };
  if (response.status === 403) return { forbidden: true };
  if (!response.ok) throw new Error('Could not update the crowd level. Please try again.');
  const crowd = await response.json().catch(() => null);
  if (!validCrowd(crowd)) throw new Error('Could not update the crowd level. Please try again.');
  return { crowd };
}
