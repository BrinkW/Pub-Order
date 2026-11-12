import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Login from './Login.jsx';
import { getSupabase } from './supabase.js';

vi.mock('./supabase.js', () => ({
  getSupabase: vi.fn(),
}));

let auth;

beforeEach(() => {
  auth = {
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
  };
  getSupabase.mockReturnValue({ auth });
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function setup(props = {}) {
  const user = userEvent.setup();
  render(<Login {...props} />);
  return user;
}

async function fillSignIn(user, email = 'student@vanderbilt.edu', password = 'secret123') {
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
}

function submitButton(name = 'Sign in') {
  return screen.getByRole('button', { name });
}

describe('Login form validation', () => {
  it('requires email and password', async () => {
    const user = setup();

    await user.click(submitButton());

    expect(screen.getByText('Enter your email.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('rejects a badly formed email', async () => {
    const user = setup();

    await fillSignIn(user, 'not-an-email');
    await user.click(submitButton());

    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('requires the confirmation password on sign up', async () => {
    const user = setup();

    await user.click(screen.getByRole('tab', { name: 'Sign up' }));
    await fillSignIn(user);
    await user.click(submitButton('Create account'));

    expect(screen.getByText('Confirm your password.')).toBeInTheDocument();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('rejects mismatched passwords on sign up', async () => {
    const user = setup();

    await user.click(screen.getByRole('tab', { name: 'Sign up' }));
    await fillSignIn(user);
    await user.type(screen.getByLabelText('Confirm password'), 'different');
    await user.click(submitButton('Create account'));

    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('only lets a Vanderbilt email sign up (SEC-02)', async () => {
    const user = setup();

    await fillSignUp(user, 'someone@gmail.com');
    await user.click(submitButton('Create account'));

    expect(screen.getByText('Use your @vanderbilt.edu email address.')).toBeInTheDocument();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('still lets an existing account with another email sign in', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: { code: 'invalid_credentials' } });
    const user = setup();

    await fillSignIn(user, 'staff@example.com');
    await user.click(submitButton());

    expect(screen.queryByText('Use your @vanderbilt.edu email address.')).not.toBeInTheDocument();
    expect(auth.signInWithPassword).toHaveBeenCalled();
  });
});

describe('Login form controls', () => {
  it('shows and hides the password', async () => {
    const user = setup();
    const password = screen.getByLabelText('Password');

    expect(password).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Hide' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('switches tabs and clears errors', async () => {
    const user = setup();

    await user.click(submitButton());
    expect(screen.getByText('Enter your email.')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Sign up' }));

    expect(screen.queryByText('Enter your email.')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sign up' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
    expect(submitButton('Create account')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Sign in' }));

    expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument();
  });

  it('explains when Supabase is not configured', async () => {
    getSupabase.mockReturnValue(null);
    const user = setup();

    await fillSignIn(user);
    await user.click(submitButton());

    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in is not configured yet.');
    expect(fetch).not.toHaveBeenCalled();
  });
});

function meResponse(ok, body) {
  return {
    ok,
    json: body === undefined ? vi.fn().mockRejectedValue(new SyntaxError('no body')) : vi.fn().mockResolvedValue(body),
  };
}

function session(token = 'access-token') {
  return { data: { session: { access_token: token } }, error: null };
}

async function fillSignUp(user, email = 'student@vanderbilt.edu', password = 'secret123') {
  await user.click(screen.getByRole('tab', { name: 'Sign up' }));
  await fillSignIn(user, email, password);
  await user.type(screen.getByLabelText('Confirm password'), password);
}

describe('Signing in', () => {
  it('signs in and confirms the session with the backend', async () => {
    auth.signInWithPassword.mockResolvedValue(session('abc.def.ghi'));
    fetch.mockResolvedValue(meResponse(true, { id: 'user-123', email: 'student@vanderbilt.edu' }));
    const user = setup();

    await fillSignIn(user, '  student@vanderbilt.edu  ');
    await user.click(submitButton());

    expect(await screen.findByRole('status')).toHaveTextContent('Signed in as student@vanderbilt.edu.');
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'student@vanderbilt.edu',
      password: 'secret123',
    });
    expect(fetch).toHaveBeenCalledWith('/api/me', {
      headers: { Authorization: 'Bearer abc.def.ghi' },
    });
  });

  it.each([
    ['invalid_credentials', 'Email or password is incorrect.'],
    ['email_not_confirmed', 'You need to confirm your email before you can sign in.'],
    ['something_else', 'Could not sign in. Try again.'],
  ])('shows a message for the %s error', async (code, message) => {
    auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: { code } });
    const user = setup();

    await fillSignIn(user);
    await user.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('handles a response with no session and no error', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: null });
    const user = setup();

    await fillSignIn(user);
    await user.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not sign in. Try again.');
  });

  it('shows the backend error when the session cannot be confirmed', async () => {
    auth.signInWithPassword.mockResolvedValue(session());
    fetch.mockResolvedValue(meResponse(false, { detail: 'Sign-in is not configured.' }));
    const user = setup();

    await fillSignIn(user);
    await user.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in is not configured.');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('falls back to a generic message when the backend returns no JSON', async () => {
    auth.signInWithPassword.mockResolvedValue(session());
    fetch.mockResolvedValue(meResponse(false));
    const user = setup();

    await fillSignIn(user);
    await user.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('The server could not confirm this sign-in.');
  });

  it('disables the submit button while signing in', async () => {
    let finish;
    auth.signInWithPassword.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = setup();

    await fillSignIn(user);
    await user.click(submitButton());

    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();

    finish({ data: { session: null }, error: { code: 'invalid_credentials' } });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });
});

describe('Signing up', () => {
  it.each([
    ['user_already_exists', 'An account with this email already exists.'],
    ['email_exists', 'An account with this email already exists.'],
    ['weak_password', 'Use at least 6 characters.'],
    ['something_else', 'Could not create the account. Try again.'],
  ])('shows a message for the %s error', async (code, message) => {
    auth.signUp.mockResolvedValue({ data: {}, error: { code } });
    const user = setup();

    await fillSignUp(user);
    await user.click(submitButton('Create account'));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'student@vanderbilt.edu',
      password: 'secret123',
      options: { emailRedirectTo: window.location.origin },
    });
  });

  it('sends the user to sign in when email confirmation is required', async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    const user = setup();

    await fillSignUp(user);
    await user.click(submitButton('Create account'));

    expect(await screen.findByRole('status')).toHaveTextContent('Account created. Check your email for a confirmation link, then sign in.');
    expect(screen.getByRole('tab', { name: 'Sign in' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByLabelText('Email')).toHaveValue('student@vanderbilt.edu');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('signs in immediately when Supabase returns a session', async () => {
    auth.signUp.mockResolvedValue(session('new-user-token'));
    fetch.mockResolvedValue(meResponse(true, { id: 'user-456', email: 'student@vanderbilt.edu' }));
    const user = setup();

    await fillSignUp(user);
    await user.click(submitButton('Create account'));

    expect(await screen.findByRole('status')).toHaveTextContent('Signed in as student@vanderbilt.edu.');
    expect(fetch).toHaveBeenCalledWith('/api/me', {
      headers: { Authorization: 'Bearer new-user-token' },
    });
  });
});

describe('Callbacks to the app', () => {
  it('reports the signed-in email after signing in', async () => {
    const onSignedIn = vi.fn();
    auth.signInWithPassword.mockResolvedValue(session());
    fetch.mockResolvedValue(meResponse(true, { id: 'user-123', email: 'student@vanderbilt.edu' }));
    const user = setup({ onSignedIn });

    await fillSignIn(user);
    await user.click(submitButton());

    await screen.findByRole('status');
    expect(onSignedIn).toHaveBeenCalledExactlyOnceWith({ email: 'student@vanderbilt.edu', role: 'student' });
  });

  it('reports the signed-in email after a sign-up that returns a session', async () => {
    const onSignedIn = vi.fn();
    auth.signUp.mockResolvedValue(session());
    fetch.mockResolvedValue(meResponse(true, { id: 'user-456', email: 'student@vanderbilt.edu' }));
    const user = setup({ onSignedIn });

    await fillSignUp(user);
    await user.click(submitButton('Create account'));

    await screen.findByRole('status');
    expect(onSignedIn).toHaveBeenCalledExactlyOnceWith({ email: 'student@vanderbilt.edu', role: 'student' });
  });

  it('does not report a sign-in that Supabase rejects', async () => {
    const onSignedIn = vi.fn();
    auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: { code: 'invalid_credentials' } });
    const user = setup({ onSignedIn });

    await fillSignIn(user);
    await user.click(submitButton());

    await screen.findByRole('alert');
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('does not report a sign-in the backend cannot confirm', async () => {
    const onSignedIn = vi.fn();
    auth.signInWithPassword.mockResolvedValue(session());
    fetch.mockResolvedValue(meResponse(false, { detail: 'Sign in required.' }));
    const user = setup({ onSignedIn });

    await fillSignIn(user);
    await user.click(submitButton());

    await screen.findByRole('alert');
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('shows Browse menu only when the app provides it', async () => {
    const onBrowse = vi.fn();
    const user = setup({ onBrowse });

    await user.click(screen.getByRole('button', { name: 'Browse menu' }));

    expect(onBrowse).toHaveBeenCalledTimes(1);
  });

  it('hides Browse menu without a handler', () => {
    setup();

    expect(screen.queryByRole('button', { name: 'Browse menu' })).not.toBeInTheDocument();
  });

  it('disables Browse menu while signing in', async () => {
    auth.signInWithPassword.mockReturnValue(new Promise(() => {}));
    const user = setup({ onBrowse: vi.fn() });

    await fillSignIn(user);
    await user.click(submitButton());

    expect(screen.getByRole('button', { name: 'Browse menu' })).toBeDisabled();
  });
});
