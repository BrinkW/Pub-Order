import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';

vi.mock('./CrowdMeter.jsx', () => ({ CrowdMeter: () => null, CrowdMeterControls: () => null }));
vi.mock('./supabase.js', () => ({
  getSupabase: vi.fn(() => null),
}));

beforeEach(() => {
  window.location.hash = '';
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
});

afterEach(() => {
  window.location.hash = '';
  vi.unstubAllGlobals();
});

function loginPage() {
  return screen.queryByRole('tab', { name: 'Sign in' });
}

function menuHeading() {
  return screen.queryByRole('heading', { name: 'What sounds good?' });
}

describe('App navigation', () => {
  it('starts on the login page', () => {
    render(<App />);

    expect(loginPage()).toBeInTheDocument();
    expect(menuHeading()).not.toBeInTheDocument();
  });

  it('opens the menu directly when the address ends in #menu', () => {
    window.location.hash = '#menu';

    render(<App />);

    expect(menuHeading()).toBeInTheDocument();
  });

  it('Browse menu opens the menu and updates the address', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Browse menu' }));

    expect(menuHeading()).toBeInTheDocument();
    expect(window.location.hash).toBe('#menu');
  });

  it('Sign in on the menu returns to the login page', async () => {
    const user = userEvent.setup();
    window.location.hash = '#menu';
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(loginPage()).toBeInTheDocument();
    expect(window.location.hash).toBe('#login');
  });

  it('follows address changes such as the browser back button', async () => {
    render(<App />);

    window.location.hash = '#menu';
    expect(await screen.findByRole('heading', { name: 'What sounds good?' })).toBeInTheDocument();

    window.location.hash = '#login';
    expect(await screen.findByRole('tab', { name: 'Sign in' })).toBeInTheDocument();
  });
});
