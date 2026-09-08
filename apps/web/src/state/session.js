import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Session state.
 *
 * One fetch of /auth/me establishes who the caller is and which organizations
 * they belong to. Everything else in the interface derives from that, so the
 * client never guesses at permissions — it asks, and the server answers.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, } from 'react';
import { api, ApiError } from '../lib/api';
const SessionContext = createContext(null);
export function SessionProvider({ children }) {
    const [status, setStatus] = useState('loading');
    const [me, setMe] = useState(null);
    const refresh = useCallback(async () => {
        try {
            const response = await api.get('/api/v1/auth/me');
            setMe(response);
            setStatus('signed-in');
        }
        catch (error) {
            // A 401 is the normal signed-out state, not a failure worth surfacing.
            if (error instanceof ApiError && error.status === 401) {
                setMe(null);
                setStatus('signed-out');
                return;
            }
            setMe(null);
            setStatus('signed-out');
        }
    }, []);
    const signOut = useCallback(async () => {
        try {
            await api.post('/api/v1/auth/logout');
        }
        finally {
            setMe(null);
            setStatus('signed-out');
        }
    }, []);
    useEffect(() => {
        void refresh();
    }, [refresh]);
    const value = useMemo(() => ({ status, me, refresh, signOut }), [status, me, refresh, signOut]);
    return _jsx(SessionContext.Provider, { value: value, children: children });
}
export function useSession() {
    const value = useContext(SessionContext);
    if (value === null)
        throw new Error('useSession must be used inside a SessionProvider');
    return value;
}
/** Remembers whether this browser has already seen the full introduction. */
const INTRO_KEY = 'core.intro.seen.v1';
export function hasSeenIntro() {
    try {
        return localStorage.getItem(INTRO_KEY) === '1';
    }
    catch {
        // Private browsing, or site data blocked. Treat as a first visit.
        return false;
    }
}
export function markIntroSeen() {
    try {
        localStorage.setItem(INTRO_KEY, '1');
    }
    catch {
        // Not being able to remember is not an error worth showing anyone.
    }
}
