/**
 * Authentication.
 *
 * One page, four steps: choose, sign in, create an account, verify. Kept on a
 * single route so the browser back button behaves and so a half-finished
 * signup can be resumed without hunting for a URL.
 *
 * Server messages are shown as written. The API deliberately does not reveal
 * whether an address is registered, and the interface does not undo that by
 * guessing.
 */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { ErrorState } from '../components/Bits';
import { api, ApiError, type MeResponse } from '../lib/api';
import { useSession } from '../state/session';

type Step = 'choose' | 'sign-in' | 'sign-up' | 'verify';

export function WelcomePage(): ReactNode {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { status, me, refresh } = useSession();

  const initialStep = (params.get('step') as Step | null) ?? 'choose';
  // The Google callback redirects here with a readable message on failure.
  const redirectError = params.get('error');
  const [step, setStep] = useState<Step>(initialStep);
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<MeResponse['capabilities'] | null>(null);

  // Already signed in and verified: there is nothing to do here.
  useEffect(() => {
    if (status !== 'signed-in' || me === null) return;
    if (!me.user.emailVerified) {
      setStep('verify');
      setEmail(me.user.email);
      return;
    }
    const first = me.organizations[0];
    navigate(first === undefined ? '/setup' : `/o/${first.id}`, { replace: true });
  }, [status, me, navigate]);

  const go = useCallback(
    (next: Step) => {
      setStep(next);
      setError(null);
      setNote(null);
      const updated = new URLSearchParams(params);
      updated.set('step', next);
      setParams(updated, { replace: true });
    },
    [params, setParams],
  );

  const afterAuthenticated = useCallback(async () => {
    await refresh();
    const response = await api.get<MeResponse>('/api/v1/auth/me').catch(() => null);
    const first = response?.organizations[0];
    navigate(first === undefined ? '/setup' : `/o/${first.id}`, { replace: true });
  }, [refresh, navigate]);

  const submit = useCallback(
    async (event: FormEvent, work: () => Promise<void>) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await work();
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError(0, {
                error: { code: 'unknown', message: 'Something unexpected went wrong.' },
              }),
        );
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const fieldErrors = error?.fieldErrors() ?? {};

  return (
    <div className="auth">
      <div className="auth-inner">
        <header>
          <p className="auth-mark">C.O.R.E.</p>
          <p className="auth-wordmark">Continuity · Operations · Risk · Execution</p>
        </header>

        {redirectError !== null && (
          <p className="notice notice-error" role="alert" style={{ marginTop: 'var(--s-5)' }}>
            {redirectError}
          </p>
        )}

        {step === 'choose' && (
          <div className="auth-card card stack">
            <div>
              <h1 style={{ fontSize: 'var(--step-2)' }}>Understand what matters.</h1>
              <p className="muted" style={{ marginTop: 'var(--s-2)' }}>
                See how your organization actually works, what would happen if part of it stopped,
                and what to do about it.
              </p>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => go('sign-up')}>
              Create an account
            </button>
            <button type="button" className="btn" onClick={() => go('sign-in')}>
              Sign in
            </button>
          </div>
        )}

        {step === 'sign-in' && (
          <form
            className="auth-card card stack"
            onSubmit={(event) =>
              void submit(event, async () => {
                const result = await api.post<{ status?: string; error?: { code: string } }>(
                  '/api/v1/auth/login',
                  { email, password },
                );
                if (result.error?.code === 'email_unverified') {
                  setNote('We have sent you a new verification code.');
                  go('verify');
                  return;
                }
                await afterAuthenticated();
              })
            }
          >
            <h1 style={{ fontSize: 'var(--step-2)' }}>Sign in</h1>

            <label className="field">
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            {error !== null && (
              <p className="error" role="alert">
                {error.message}
              </p>
            )}

            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>

            {capabilities?.googleSignIn === true && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  // The server builds the URL and sets the state cookie, so the
                  // client never holds the client id or invents the state.
                  void api
                    .get<{ url: string }>('/api/v1/auth/google/start')
                    .then((response) => {
                      window.location.assign(response.url);
                    })
                    .catch((caught: unknown) => {
                      setError(caught instanceof ApiError ? caught : null);
                    });
                }}
              >
                Continue with Google
              </button>
            )}

            <p className="auth-switch">
              <button type="button" className="btn-quiet btn btn-sm" onClick={() => go('sign-up')}>
                Create an account
              </button>
            </p>
          </form>
        )}

        {step === 'sign-up' && (
          <form
            className="auth-card card stack"
            onSubmit={(event) =>
              void submit(event, async () => {
                const result = await api.post<{
                  message: string;
                  emailDeliveryConfigured: boolean;
                }>('/api/v1/auth/register', { name, email, password });
                setNote(
                  result.emailDeliveryConfigured
                    ? result.message
                    : `${result.message} This deployment has no email provider configured, so the code was written to the server log.`,
                );
                go('verify');
              })
            }
          >
            <h1 style={{ fontSize: 'var(--step-2)' }}>Create an account</h1>

            <label className="field">
              <span>Your name</span>
              <input
                autoComplete="name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              {fieldErrors['email']?.map((message) => (
                <span key={message} className="error">
                  {message}
                </span>
              ))}
            </label>

            <label className="field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <span className="hint">At least 10 characters. Not your name or email.</span>
              {fieldErrors['password']?.map((message) => (
                <span key={message} className="error">
                  {message}
                </span>
              ))}
            </label>

            {error !== null && Object.keys(fieldErrors).length === 0 && (
              <p className="error" role="alert">
                {error.message}
              </p>
            )}

            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create account'}
            </button>

            <p className="auth-switch">
              <button type="button" className="btn-quiet btn btn-sm" onClick={() => go('sign-in')}>
                I already have an account
              </button>
            </p>
          </form>
        )}

        {step === 'verify' && (
          <form
            className="auth-card card stack"
            onSubmit={(event) =>
              void submit(event, async () => {
                await api.post('/api/v1/auth/verify', { email, code });
                await afterAuthenticated();
              })
            }
          >
            <h1 style={{ fontSize: 'var(--step-2)' }}>Check your email</h1>
            <p className="muted">
              We sent a six-digit code to <strong>{email}</strong>. It expires in 15 minutes.
            </p>

            {note !== null && <p className="notice">{note}</p>}

            <label className="field">
              <span>Verification code</span>
              <input
                className="code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
              />
            </label>

            {error !== null && (
              <p className="error" role="alert">
                {error.message}
              </p>
            )}

            <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
              {busy ? 'Verifying…' : 'Verify and continue'}
            </button>

            <button
              type="button"
              className="btn btn-quiet btn-sm"
              disabled={busy}
              onClick={() =>
                void submit(new Event('submit') as unknown as FormEvent, async () => {
                  const result = await api.post<{ message: string }>('/api/v1/auth/resend', {
                    email,
                  });
                  setNote(result.message);
                })
              }
            >
              Send a new code
            </button>

            <p className="auth-switch">
              <button type="button" className="btn-quiet btn btn-sm" onClick={() => go('sign-in')}>
                Use a different account
              </button>
            </p>
          </form>
        )}

        {error?.status === 0 && (
          <div style={{ marginTop: 'var(--s-5)' }}>
            <ErrorState
              title="Cannot reach the server"
              message="The API is not responding. If you are running this locally, check that it is started."
            />
          </div>
        )}

        <CapabilityProbe onLoaded={setCapabilities} />
      </div>
    </div>
  );
}

/**
 * Ask the server what it can actually do, so the interface only offers what is
 * configured. A Google button that cannot work is worse than no button.
 */
function CapabilityProbe({
  onLoaded,
}: {
  onLoaded: (value: MeResponse['capabilities']) => void;
}): ReactNode {
  useEffect(() => {
    let cancelled = false;
    void api
      .get<MeResponse>('/api/v1/auth/me')
      .then((response) => {
        if (!cancelled) onLoaded(response.capabilities);
      })
      .catch(() => {
        // Signed out, which is the normal case on this page.
      });
    return () => {
      cancelled = true;
    };
  }, [onLoaded]);
  return null;
}
