// Integration tests: the real App, Login, Menu, cart logic, and browser storage
// working together. Only the outside services (Supabase, /api/menu and /api/me) are faked.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { CART_STORAGE_KEY } from './cart.js';
import { MENU_ITEMS } from './menu-data.js';
import { getSupabase } from './supabase.js';

vi.mock('./CrowdMeter.jsx', () => ({ CrowdMeter: () => null, CrowdMeterControls: () => null }));
vi.mock('./supabase.js', () => ({
  getSupabase: vi.fn(),
}));

const EMAIL = 'student@vanderbilt.edu';
const catalog = MENU_ITEMS.map((item) => ({ ...item, available: true }));
let auth;
let meResponse;

function json(body, ok = true) {
  return { ok, status: ok ? 200 : 401, json: async () => body };
}

beforeEach(() => {
  window.location.hash = '';
  window.localStorage.clear();
  auth = {
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
  };
  getSupabase.mockReturnValue({ auth });
  meResponse = json({ id: 'user-1', email: EMAIL });
  vi.stubGlobal('fetch', vi.fn(async (url) => (url === '/api/menu' ? json(catalog) : meResponse)));
});

afterEach(() => {
  window.location.hash = '';
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function signIn(user) {
  await user.type(screen.getByLabelText('Email'), EMAIL);
  await user.type(screen.getByLabelText('Password'), 'secret123');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('Sign in to menu', () => {
  it('signs in, opens the menu, and keeps the cart across pages', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { session: { access_token: 'token-1' } }, error: null });
    const user = userEvent.setup();
    render(<App />);

    await signIn(user);

    expect(await screen.findByText(`Signed in as ${EMAIL}`)).toBeInTheDocument();
    expect(window.location.hash).toBe('#menu');
    expect(fetch).toHaveBeenCalledWith('/api/me', { headers: { Authorization: 'Bearer token-1' } });

    await user.click(await screen.findByRole('button', { name: 'Add Pub Burger' }));
    expect(JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY)).items).toEqual({ 'pub-burger': 1 });

    await user.click(screen.getByRole('button', { name: 'Back to login' }));
    await user.click(screen.getByRole('button', { name: 'Browse menu' }));

    expect(screen.getByRole('heading', { name: 'Your meal (1)' })).toBeInTheDocument();
  });

  it('stays on the login page when the backend rejects the session', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { session: { access_token: 'token-1' } }, error: null });
    meResponse = json({ detail: 'Sign in required.' }, false);
    const user = userEvent.setup();
    render(<App />);

    await signIn(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in required.');
    expect(screen.queryByRole('heading', { name: 'What sounds good?' })).not.toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });
});
