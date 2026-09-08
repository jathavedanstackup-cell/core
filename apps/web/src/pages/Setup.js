import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * First organization.
 *
 * Deliberately short. The product asks for a name, where the organization
 * mainly operates, and a few areas of the business that matter — and then gets
 * out of the way. A long setup form before anyone has seen any value is how
 * this kind of tool gets abandoned.
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useSession } from '../state/session';
export function SetupPage() {
    const navigate = useNavigate();
    const { me, refresh } = useSession();
    const [name, setName] = useState('');
    const [region, setRegion] = useState('');
    const [areas, setAreas] = useState(['', '', '']);
    const [busy, setBusy] = useState('none');
    const [error, setError] = useState(null);
    const run = useCallback(async (kind, work) => {
        if (busy !== 'none')
            return;
        setBusy(kind);
        setError(null);
        try {
            const result = await work();
            await refresh();
            navigate(`/o/${result.organization.id}`, { replace: true });
        }
        catch (caught) {
            setError(caught instanceof ApiError ? caught.message : 'Something unexpected went wrong.');
            setBusy('none');
        }
    }, [busy, refresh, navigate]);
    return (_jsx("div", { className: "auth", children: _jsxs("div", { className: "auth-inner", style: { maxWidth: '34rem' }, children: [_jsxs("header", { children: [_jsx("p", { className: "auth-mark", children: "C.O.R.E." }), _jsx("p", { className: "auth-wordmark", children: "Continuity \u00B7 Operations \u00B7 Risk \u00B7 Execution" })] }), _jsxs("form", { className: "auth-card card stack", onSubmit: (event) => {
                        event.preventDefault();
                        void run('create', () => api.post('/api/v1/organizations', {
                            name,
                            primaryRegion: region.trim() === '' ? undefined : region.trim(),
                            importantAreas: areas.map((area) => area.trim()).filter((area) => area !== ''),
                        }));
                    }, children: [_jsxs("div", { children: [_jsx("h1", { style: { fontSize: 'var(--step-2)' }, children: me === null ? 'Set up your organization' : `Welcome, ${me.user.name.split(' ')[0]}` }), _jsx("p", { className: "muted", style: { marginTop: 'var(--s-2)' }, children: "Three questions now. You can build out the rest whenever you like." })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Organization name" }), _jsx("input", { required: true, value: name, onChange: (event) => setName(event.target.value) })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: "Where do you mainly operate?" }), _jsx("input", { value: region, placeholder: "United Kingdom", onChange: (event) => setRegion(event.target.value) }), _jsx("span", { className: "hint", children: "Optional." })] }), _jsxs("fieldset", { style: { border: 0, padding: 0 }, children: [_jsx("legend", { className: "field", style: {
                                        fontSize: 'var(--step--1)',
                                        fontWeight: 600,
                                        color: 'var(--ink-soft)',
                                        marginBottom: 'var(--s-2)',
                                        padding: 0,
                                    }, children: "What are the most important things your organization does?" }), _jsx("div", { className: "stack-sm", children: areas.map((area, index) => (_jsx("input", { className: "field", style: {
                                            width: '100%',
                                            padding: '0.6rem 0.75rem',
                                            border: '1px solid var(--line-strong)',
                                            borderRadius: 'var(--radius-sm)',
                                            background: 'var(--paper-raised)',
                                        }, value: area, placeholder: ['Pay staff', 'Dispatch customer orders', 'Answer customer enquiries'][index] ??
                                            'Another important area', onChange: (event) => {
                                            const next = [...areas];
                                            next[index] = event.target.value;
                                            setAreas(next);
                                        } }, index))) }), _jsx("p", { className: "hint", style: { marginTop: 'var(--s-2)', fontSize: 'var(--step--1)', color: 'var(--ink-faint)' }, children: "Each becomes a business function you can build out. Leave any blank." })] }), error !== null && (_jsx("p", { className: "error", role: "alert", style: { color: 'var(--band-critical)' }, children: error })), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy !== 'none', children: busy === 'create' ? 'Creating…' : 'Create organization' })] }), me?.capabilities.demoMode === true && (_jsxs("div", { className: "card stack", style: { marginTop: 'var(--s-5)' }, children: [_jsxs("div", { children: [_jsx("h2", { style: { fontSize: 'var(--step-1)' }, children: "Or look around first" }), _jsx("p", { className: "muted", style: { marginTop: 'var(--s-2)', fontSize: 'var(--step--1)' }, children: "A worked example: a logistics company with a payroll process only one person can run, a supplier with no second source, and a database two critical functions sit on. The company is invented. The analysis of it is the real engine." })] }), _jsx("button", { type: "button", className: "btn", disabled: busy !== 'none', onClick: () => void run('demo', () => api.post('/api/v1/organizations/demo')), children: busy === 'demo' ? 'Building…' : 'Open the demo organization' })] }))] }) }));
}
