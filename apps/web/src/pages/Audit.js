import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Audit trail.
 *
 * Read-only, newest first. There is no edit and no delete anywhere in the
 * product, because a record that can be rewritten is not a record.
 *
 * Reading it needs the LEADER role, so a viewer landing here is told that
 * plainly rather than shown an empty page.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Empty, ErrorState, Loading } from '../components/Bits';
import { api, ApiError } from '../lib/api';
export function AuditPage() {
    const { orgId } = useParams();
    const [events, setEvents] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (orgId === undefined)
            return;
        let cancelled = false;
        void api
            .get(`/api/v1/audit/${orgId}`)
            .then((response) => {
            if (!cancelled)
                setEvents(response.events);
        })
            .catch((caught) => {
            if (!cancelled)
                setError(caught instanceof ApiError ? caught : null);
        });
        return () => {
            cancelled = true;
        };
    }, [orgId]);
    if (error !== null) {
        return (_jsx(ErrorState, { title: error.status === 403 ? 'Not available to your role' : 'Could not load the audit trail', message: error.message, requestId: error.requestId }));
    }
    if (events === null)
        return _jsx(Loading, { what: "the audit trail" });
    return (_jsxs("div", { className: "stack-lg", children: [_jsxs("header", { className: "page-head", children: [_jsx("h1", { style: { fontSize: 'var(--step-3)' }, children: "Audit trail" }), _jsx("p", { className: "lede", children: "Who changed what, and when. Append-only: nothing in C.O.R.E. can edit or remove an entry." })] }), events.length === 0 ? (_jsx(Empty, { title: "Nothing recorded yet." })) : (_jsx("div", { className: "table-wrap", children: _jsxs("table", { className: "data", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "When" }), _jsx("th", { children: "Who" }), _jsx("th", { children: "What" }), _jsx("th", { children: "Change" })] }) }), _jsx("tbody", { children: events.map((event) => (_jsxs("tr", { children: [_jsx("td", { className: "timeline-when", style: { whiteSpace: 'nowrap' }, children: new Date(event.createdAt).toLocaleString() }), _jsx("td", { children: event.actor ?? 'system' }), _jsxs("td", { children: [_jsx("strong", { children: event.action.replace(/_/g, ' ') }), _jsxs("span", { className: "verify-note", style: { display: 'block' }, children: [event.entityType, event.entityId !== null ? ` · ${event.entityId}` : ''] })] }), _jsx("td", { style: { maxWidth: '26rem' }, children: _jsx(ChangeSummary, { before: event.before, after: event.after }) })] }, event.id))) })] }) }))] }));
}
/** Renders the recorded before/after without pretending to more precision. */
function ChangeSummary({ before, after }) {
    const describe = (value) => {
        if (value === null || value === undefined)
            return null;
        if (typeof value !== 'object')
            return String(value);
        const entries = Object.entries(value)
            .filter(([, item]) => item !== null && item !== undefined)
            .slice(0, 4)
            .map(([key, item]) => `${key}: ${typeof item === 'object' ? '…' : String(item)}`);
        return entries.length === 0 ? null : entries.join(', ');
    };
    const from = describe(before);
    const to = describe(after);
    if (from === null && to === null)
        return _jsx("span", { className: "faint", children: "\u2014" });
    return (_jsxs("span", { style: { fontSize: 'var(--step--1)' }, children: [from !== null && (_jsxs("span", { className: "faint", style: { display: 'block' }, children: ["was \u2014 ", from] })), to !== null && _jsxs("span", { style: { display: 'block' }, children: ["now \u2014 ", to] })] }));
}
