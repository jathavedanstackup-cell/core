import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * "What happens if…?"
 *
 * Pick what becomes unavailable, and see what stops, in the order it stops.
 * Waves are the point: knowing that the database goes first and payroll goes
 * four steps later is what tells a responder where the front line is.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Empty, ErrorState, Eyebrow, Loading } from '../components/Bits';
import { api, ApiError } from '../lib/api';
export function ScenariosPage() {
    const { orgId } = useParams();
    const [entities, setEntities] = useState(null);
    const [history, setHistory] = useState([]);
    const [selected, setSelected] = useState([]);
    const [current, setCurrent] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (orgId === undefined)
            return;
        let cancelled = false;
        void Promise.all([
            api.get(`/api/v1/model/${orgId}/entities`),
            api.get(`/api/v1/${orgId}/scenarios`),
        ])
            .then(([entityResponse, historyResponse]) => {
            if (cancelled)
                return;
            setEntities(entityResponse.entities);
            setHistory(historyResponse.runs);
        })
            .catch((caught) => {
            if (!cancelled)
                setError(caught instanceof ApiError ? caught : null);
        });
        return () => {
            cancelled = true;
        };
    }, [orgId]);
    const run = useCallback(async () => {
        if (orgId === undefined || selected.length === 0 || busy)
            return;
        setBusy(true);
        setError(null);
        try {
            const response = await api.post(`/api/v1/${orgId}/scenarios`, {
                failedRefs: selected,
            });
            setCurrent(response);
            const refreshed = await api.get(`/api/v1/${orgId}/scenarios`);
            setHistory(refreshed.runs);
        }
        catch (caught) {
            setError(caught instanceof ApiError ? caught : null);
        }
        finally {
            setBusy(false);
        }
    }, [orgId, selected, busy]);
    const openRun = useCallback(async (runId) => {
        if (orgId === undefined)
            return;
        const response = await api.get(`/api/v1/${orgId}/scenarios/${runId}`);
        setCurrent(response);
        setSelected([]);
    }, [orgId]);
    if (error !== null && entities === null) {
        return _jsx(ErrorState, { title: "Could not load", message: error.message, requestId: error.requestId });
    }
    if (entities === null)
        return _jsx(Loading, { what: "your organization" });
    const grouped = new Map();
    for (const entity of entities) {
        const list = grouped.get(entity.kind) ?? [];
        list.push(entity);
        grouped.set(entity.kind, list);
    }
    return (_jsxs("div", { className: "stack-lg", children: [_jsxs("header", { className: "page-head", children: [_jsx("h1", { style: { fontSize: 'var(--step-3)' }, children: "What happens if\u2026?" }), _jsx("p", { className: "lede", children: "Choose what becomes unavailable. C.O.R.E. follows your recorded dependencies and reports what stops, in the order it stops." })] }), _jsxs("section", { className: "card", children: [_jsx(Eyebrow, { children: "Choose what fails" }), _jsx("div", { style: { marginTop: 'var(--s-3)', display: 'grid', gap: 'var(--s-4)' }, children: [...grouped.entries()].map(([kind, items]) => (_jsxs("div", { children: [_jsx("p", { className: "faint", style: { fontSize: 'var(--step--1)', marginBottom: 'var(--s-2)' }, children: kind.replace(/_/g, ' ') }), _jsx("div", { className: "row", children: items.map((entity) => {
                                        const on = selected.includes(entity.ref);
                                        return (_jsx("button", { type: "button", className: on ? 'btn btn-sm btn-primary' : 'btn btn-sm', "aria-pressed": on, onClick: () => setSelected((previous) => previous.includes(entity.ref)
                                                ? previous.filter((ref) => ref !== entity.ref)
                                                : [...previous, entity.ref]), children: entity.name }, entity.ref));
                                    }) })] }, kind))) }), _jsxs("div", { className: "row", style: { marginTop: 'var(--s-5)' }, children: [_jsx("button", { type: "button", className: "btn btn-primary", disabled: selected.length === 0 || busy, onClick: () => void run(), children: busy ? 'Running…' : `Run scenario${selected.length > 0 ? ` (${selected.length})` : ''}` }), selected.length > 0 && (_jsx("button", { type: "button", className: "btn btn-quiet btn-sm", onClick: () => setSelected([]), children: "Clear" }))] }), error !== null && (_jsx("p", { className: "error", role: "alert", style: { marginTop: 'var(--s-3)', color: 'var(--band-critical)' }, children: error.message }))] }), current !== null && _jsx(ScenarioOutcome, { run: current }), history.length > 0 && (_jsxs("section", { children: [_jsxs("div", { className: "tier-head", children: [_jsx("h2", { className: "tier-title", children: "Previous runs" }), _jsx("span", { className: "faint", style: { fontSize: 'var(--step--1)' }, children: "Newest first. Each keeps the result it produced at the time." })] }), _jsx("ul", { className: "finding-list", children: history.map((item) => (_jsx("li", { children: _jsxs("button", { type: "button", className: "finding", style: { width: '100%', textAlign: 'left', cursor: 'pointer' }, onClick: () => void openRun(item.id), children: [_jsx("p", { className: "finding-summary", children: item.description }), _jsx("p", { className: "finding-rationale", children: new Date(item.createdAt).toLocaleString() })] }) }, item.id))) })] }))] }));
}
function ScenarioOutcome({ run }) {
    const { result } = run;
    const failedCount = result.impacted.filter((item) => item.state === 'FAILED').length;
    const degradedCount = result.impacted.filter((item) => item.state === 'DEGRADED').length;
    if (result.impacted.length === 0) {
        return _jsx(Empty, { title: "Nothing recorded is affected by that." });
    }
    return (_jsxs("section", { className: "stack", children: [_jsxs("div", { className: "headline", children: [_jsx(Eyebrow, { children: "What happens" }), _jsx("p", { className: "headline-text", style: { marginTop: 'var(--s-3)' }, children: result.failedFunctions.length === 0
                            ? `${failedCount} recorded item${failedCount === 1 ? '' : 's'} stop, but no business function fails outright.`
                            : `${result.failedFunctions.map((f) => f.name).join(', ')} stop${result.failedFunctions.length === 1 ? 's' : ''}.` }), _jsxs("p", { className: "headline-sub", children: [failedCount, " item", failedCount === 1 ? '' : 's', " stop, ", degradedCount, " continue in a reduced state, across ", result.waves.length - 1, " step", result.waves.length - 1 === 1 ? '' : 's', " of knock-on effect."] })] }), _jsx("div", { className: "waves", children: result.waves.map((wave, index) => (_jsxs("div", { className: "wave", children: [_jsxs("div", { className: "wave-head", children: [_jsx("span", { children: index === 0 ? 'What you removed' : `Breaks ${index === 1 ? 'first' : `step ${index}`}` }), _jsxs("span", { style: { marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }, children: [wave.length, " item", wave.length === 1 ? '' : 's'] })] }), _jsx("ul", { className: "wave-list", children: wave.map((item) => (_jsxs("li", { className: "wave-item", children: [_jsx("span", { className: `impact-state impact-${item.state}`, children: item.state }), _jsxs("span", { children: [_jsx("strong", { children: item.name }), _jsx("span", { className: "verify-note", style: { display: 'block' }, children: item.explanation })] })] }, item.entityId))) })] }, index))) }), result.fallbacksUsed.length > 0 && (_jsxs("div", { className: "notice", children: [_jsxs("strong", { children: [result.fallbacksUsed.length, " fallback(s) held."] }), " Those parts of the organization kept working because an alternative was recorded."] })), result.missingFallbacks.length > 0 && (_jsxs("div", { className: "notice notice-warn", children: [_jsxs("strong", { children: [result.missingFallbacks.length, " place(s) had no alternative."] }), " Each is a point where the failure spread because nothing was recorded to take over."] })), _jsxs("div", { className: "notice", children: [_jsx(Eyebrow, { children: "Assumptions" }), _jsx("ul", { style: { marginTop: 'var(--s-2)', paddingLeft: '1.1rem' }, children: result.assumptions.map((assumption) => (_jsx("li", { children: assumption }, assumption))) })] })] }));
}
