import { useState } from 'react';
import { getSupabase } from './supabase.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// SEC-02: the database refuses other addresses too; this just says so before trying.
const VANDERBILT_EMAIL = /@vanderbilt\.edu$/i;

function signInMessage(error) {
  if (error.code === 'email_not_confirmed') {
    return 'You need to confirm your email before you can sign in.';
  }
  if (error.code === 'invalid_credentials') {
    return 'Email or password is incorrect.';
  }
  return 'Could not sign in. Try again.';
}

function signUpMessage(error) {
  if (error.code === 'user_already_exists' || error.code === 'email_exists') {
    return 'An account with this email already exists.';
  }
  if (error.code === 'weak_password') {
    return 'Use at least 6 characters.';
  }
  return 'Could not create the account. Try again.';
}

function validate({ email, password, confirmPassword, mode }) {
  const errors = {};
  const trimmedEmail = email.trim();

  if (!trimmedEmail) {
    errors.email = 'Enter your email.';
  } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
    errors.email = 'Enter a valid email address.';
  } else if (mode === 'sign-up' && !VANDERBILT_EMAIL.test(trimmedEmail)) {
    errors.email = 'Use your @vanderbilt.edu email address.';
  }

  if (!password) {
    errors.password = 'Enter your password.';
  }

  if (mode === 'sign-up') {
    if (!confirmPassword) {
      errors.confirmPassword = 'Confirm your password.';
    } else if (password && confirmPassword !== password) {
      errors.confirmPassword = 'Passwords do not match.';
    }
  }

  return errors;
}

async function confirmSession(session) {
  const response = await fetch('/api/me', {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || 'The server could not confirm this sign-in.');
  }
  const profile = await response.json();
  return { email: profile.email, role: profile.role === 'kitchen' ? 'kitchen' : 'student' };
}

export default function Login({ onBrowse, onSignedIn } = {}) {
  const [mode, setMode] = useState('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');

  const isSignUp = mode === 'sign-up';

  function clearFeedback() {
    setFormError('');
    setNotice('');
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setErrors({});
    setConfirmPassword('');
    clearFeedback();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const nextErrors = validate({ email, password, confirmPassword, mode });
    setErrors(nextErrors);
    clearFeedback();
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const supabase = getSupabase();
    if (!supabase) {
      setFormError('Sign-in is not configured yet.');
      return;
    }

    setSubmitting(true);
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          // The confirmation link brings the student back to this site (local or staging).
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) {
          setFormError(signUpMessage(error));
          return;
        }
        if (!data.session) {
          setPassword('');
          setConfirmPassword('');
          setMode('sign-in');
          setNotice('Account created. Check your email for a confirmation link, then sign in.');
          return;
        }
        const account = await confirmSession(data.session);
        setNotice(`Signed in as ${account.email}.`);
        onSignedIn?.(account);
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error || !data.session) {
        setFormError(error ? signInMessage(error) : 'Could not sign in. Try again.');
        return;
      }

      const account = await confirmSession(data.session);
      setNotice(`Signed in as ${account.email}.`);
      onSignedIn?.(account);
    } catch (error) {
      setFormError(
        error instanceof Error && error.message
          ? error.message
          : 'Could not reach the account service.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login">
      <section className="login-brand" aria-label="The Pub">
        <p className="login-kicker">Vanderbilt Dining</p>
        <h1>The Pub</h1>
        <p className="login-tagline">Order ahead and skip the line.</p>
      </section>

      <section className="login-panel">
        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-tabs" role="tablist" aria-label="Account">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'sign-in'}
              onClick={() => switchMode('sign-in')}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isSignUp}
              onClick={() => switchMode('sign-up')}
            >
              Sign up
            </button>
          </div>
          <h2 className="visually-hidden">{isSignUp ? 'Sign up' : 'Sign in'}</h2>
          <p className="login-intro">
            {isSignUp
              ? 'Create an account with your Vanderbilt email.'
              : 'Use your Vanderbilt email to start an order.'}
          </p>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              value={email}
              aria-invalid={errors.email ? 'true' : 'false'}
              aria-describedby={errors.email ? 'email-error' : undefined}
              onChange={(event) => {
                setEmail(event.target.value);
                clearFeedback();
              }}
            />
            {errors.email ? (
              <p id="email-error" className="field-error" role="alert">
                {errors.email}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="password-row">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                value={password}
                aria-invalid={errors.password ? 'true' : 'false'}
                aria-describedby={errors.password ? 'password-error' : undefined}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearFeedback();
                }}
              />
              <button
                type="button"
                className="password-toggle"
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {errors.password ? (
              <p id="password-error" className="field-error" role="alert">
                {errors.password}
              </p>
            ) : null}
          </div>

          {isSignUp ? (
            <div className="field">
              <label htmlFor="confirm-password">Confirm password</label>
              <div className="password-row">
                <input
                  id="confirm-password"
                  name="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmPassword}
                  aria-invalid={errors.confirmPassword ? 'true' : 'false'}
                  aria-describedby={errors.confirmPassword ? 'confirm-password-error' : undefined}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    clearFeedback();
                  }}
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {errors.confirmPassword ? (
                <p id="confirm-password-error" className="field-error" role="alert">
                  {errors.confirmPassword}
                </p>
              ) : null}
            </div>
          ) : null}

          <button type="submit" className="login-submit" disabled={submitting}>
            {submitting ? (isSignUp ? 'Creating account…' : 'Signing in…') : isSignUp ? 'Create account' : 'Sign in'}
          </button>

          <button type="button" className="login-sso">
            Sign in with SSO
          </button>

          {onBrowse ? (
            <button type="button" className="login-sso" onClick={onBrowse} disabled={submitting}>
              Browse menu
            </button>
          ) : null}

          {formError ? (
            <p className="login-error" role="alert">
              {formError}
            </p>
          ) : null}

          {notice ? (
            <p className="login-status" role="status">
              {notice}
            </p>
          ) : null}
        </form>
      </section>
    </main>
  );
}
