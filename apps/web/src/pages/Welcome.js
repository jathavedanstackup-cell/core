import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ErrorState } from '../components/Bits';
import { api, ApiError } from '../lib/api';
import { useSession } from '../state/session';
export function WelcomePage() {
    const [params, setParams] = useSearchParams();
    const navigate = useNavigate();
    const { status, me, refresh } = useSession();
    const initialStep = params.get('step') ?? 'choose';
    // The Google callback redirects here with a readable message on failure.
    const redirectError = params.get('error');
    const [step, setStep] = useState(initialStep);
    const [email, setEmail] = useState(params.get('email') ?? '');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [note, setNote] = useState(null);
    const [capabilities, setCapabilities] = useState(null);
    // Already signed in and verified: there is nothing to do here.
    useEffect(() => {
        if (status !== 'signed-in' || me === null)
            return;
        if (!me.user.emailVerified) {
            setStep('verify');
            setEmail(me.user.email);
            return;
        }
        const first = me.organizations[0];
        navigate(first === undefined ? '/setup' : `/o/${first.id}`, { replace: true });
    }, [status, me, navigate]);
    const go = useCallback((next) => {
        setStep(next);
        setError(null);
        setNote(null);
        const updated = new URLSearchParams(params);
        updated.set('step', next);
        setParams(updated, { replace: true });
    }, [params, setParams]);
    const afterAuthenticated = useCallback(async () => {
        await refresh();
        const response = await api.get('/api/v1/auth/me').catch(() => null);
        const first = response?.organizations[0];
        navigate(first === undefined ? '/setup' : `/o/${first.id}`, { replace: true });
    }, [refresh, navigate]);
    const submit = useCallback(async (event, work) => {
        event.preventDefault();
        if (busy)
            return;
        setBusy(true);
        setError(null);
        try {
            await work();
        }
        catch (caught) {
            setError(caught instanceof ApiError
                ? caught
                : new ApiError(0, {
                    error: { code: 'unknown', message: 'Something unexpected went wrong.' },
                }));
        }
        finally {
            setBusy(false);
        }
    }, [busy]);
    const fieldErrors = error?.fieldErrors() ?? {};
    return (_jsx("div", { className: "auth", children: _jsxs("div", { className: "auth-inner", children: [_jsxs("header", { children: [_jsx("p", { className: "auth-mark", children: "C.O.R.E." }), _jsx("p", { className: "auth-wordmark", children: "Continuity \u00B7 Operations \u00B7 Risk \u00B7 Execution" })] }), redirectError !== null && (_jsx("p", { className: "notice notice-error", role: "alert", style: { marginTop: 'var(--s-5)' }, children: redirectError })), step === 'choose' && (_jsxs("div", { className: "auth-card card stack", children: [_jsxs("div", { children: [_jsx("h1", { style: { fontSize: 'var(--step-2)' }, children: "Understand what matters." }), _jsx("p", { className: "muted", style: { marginTop: 'var(--s-2)' }, children: "See how your organization actually works, what would happen if part of it stopped, and what to do about it." })] }), _jsx("button", { type: "button", className: "btn btn-primary", onClick: () => go('sign-up'), children: "Create an account" }), _jsx("button", { type: "button", className: "btn", onClick: () => go('sign-in'), children: "Sign in" })] })), step === 'sign-in' && (_jsxs("form", { className: "auth-card card stack", onSubmit: (event) => void submit(event, async () => {
                        const result = await api.post('/api/v1/auth/login', { email, password });
                        if (result.error?.code === 'email_unverified') {
                            setNote('We have sent you a new verification code.');
                            go('verify');
                            return;
                        }
                        await afterAuthenticated();
                    }), children: [_jsx("h1", { style: { fontSize: 'var(--step-2)' }, children: "Sign in" }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Email" }), _jsx("input", { type: "email", autoComplete: "email", required: true, value: email, onChange: (event) => setEmail(event.target.value) })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Password" }), _jsx("input", { type: "password", autoComplete: "current-password", required: true, value: password, onChange: (event) => setPassword(event.target.value) })] }), error !== null && (_jsx("p", { className: "error", role: "alert", children: error.message })), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy, children: busy ? 'Signing in…' : 'Sign in' }), capabilities?.googleSignIn === true && (_jsx("button", { type: "button", className: "btn", onClick: () => {
                                // The server builds the URL and sets the state cookie, so the
                                // client never holds the client id or invents the state.
                                void api
                                    .get('/api/v1/auth/google/start')
                                    .then((response) => {
                                    window.location.assign(response.url);
                                })
                                    .catch((caught) => {
                                    setError(caught instanceof ApiError ? caught : null);
                                });
                            }, children: "Continue with Google" })), _jsx("p", { className: "auth-switch", children: _jsx("button", { type: "button", className: "btn-quiet btn btn-sm", onClick: () => go('sign-up'), children: "Create an account" }) })] })), step === 'sign-up' && (_jsxs("form", { className: "auth-card card stack", onSubmit: (event) => void submit(event, async () => {
                        const result = await api.post('/api/v1/auth/register', { name, email, password });
                        setNote(result.emailDeliveryConfigured
                            ? result.message
                            : `${result.message} This deployment has no email provider configured, so the code was written to the server log.`);
                        go('verify');
                    }), children: [_jsx("h1", { style: { fontSize: 'var(--step-2)' }, children: "Create an account" }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Your name" }), _jsx("input", { autoComplete: "name", required: true, value: name, onChange: (event) => setName(event.target.value) })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Email" }), _jsx("input", { type: "email", autoComplete: "email", required: true, value: email, onChange: (event) => setEmail(event.target.value) }), fieldErrors['email']?.map((message) => (_jsx("span", { className: "error", children: message }, message)))] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Password" }), _jsx("input", { type: "password", autoComplete: "new-password", required: true, value: password, onChange: (event) => setPassword(event.target.value) }), _jsx("span", { className: "hint", children: "At least 10 characters. Not your name or email." }), fieldErrors['password']?.map((message) => (_jsx("span", { className: "error", children: message }, message)))] }), error !== null && Object.keys(fieldErrors).length === 0 && (_jsx("p", { className: "error", role: "alert", children: error.message })), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy, children: busy ? 'Creating…' : 'Create account' }), _jsx("p", { className: "auth-switch", children: _jsx("button", { type: "button", className: "btn-quiet btn btn-sm", onClick: () => go('sign-in'), children: "I already have an account" }) })] })), step === 'verify' && (_jsxs("form", { className: "auth-card card stack", onSubmit: (event) => void submit(event, async () => {
                        await api.post('/api/v1/auth/verify', { email, code });
                        await afterAuthenticated();
                    }), children: [_jsx("h1", { style: { fontSize: 'var(--step-2)' }, children: "Check your email" }), _jsxs("p", { className: "muted", children: ["We sent a six-digit code to ", _jsx("strong", { children: email }), ". It expires in 15 minutes."] }), note !== null && _jsx("p", { className: "notice", children: note }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Verification code" }), _jsx("input", { className: "code-input", inputMode: "numeric", autoComplete: "one-time-code", pattern: "[0-9]{6}", maxLength: 6, required: true, value: code, onChange: (event) => setCode(event.target.value.replace(/\D/g, '')) })] }), error !== null && (_jsx("p", { className: "error", role: "alert", children: error.message })), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy || code.length !== 6, children: busy ? 'Verifying…' : 'Verify and continue' }), _jsx("button", { type: "button", className: "btn btn-quiet btn-sm", disabled: busy, onClick: () => void submit(new Event('submit'), async () => {
                                const result = await api.post('/api/v1/auth/resend', {
                                    email,
                                });
                                setNote(result.message);
                            }), children: "Send a new code" }), _jsx("p", { className: "auth-switch", children: _jsx("button", { type: "button", className: "btn-quiet btn btn-sm", onClick: () => go('sign-in'), children: "Use a different account" }) })] })), error?.status === 0 && (_jsx("div", { style: { marginTop: 'var(--s-5)' }, children: _jsx(ErrorState, { title: "Cannot reach the server", message: "The API is not responding. If you are running this locally, check that it is started." }) })), _jsx(CapabilityProbe, { onLoaded: setCapabilities })] }) }));
}
/**
 * Ask the server what it can actually do, so the interface only offers what is
 * configured. A Google button that cannot work is worse than no button.
 */
function CapabilityProbe({ onLoaded, }) {
    useEffect(() => {
        let cancelled = false;
        void api
            .get('/api/v1/auth/me')
            .then((response) => {
            if (!cancelled)
                onLoaded(response.capabilities);
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
