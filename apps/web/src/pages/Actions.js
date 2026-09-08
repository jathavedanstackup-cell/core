import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Actions.
 *
 * These are persisted records, not checkboxes in the browser. Only the
 * transitions the server permits are offered, so the interface cannot suggest
 * something the API will refuse, and a completed action always shows when it
 * completed.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Empty, ErrorState, Loading } from '../components/Bits';
import { api, ApiError } from '../lib/api';
/** Mirrors the server's state machine so no impossible move is offered. */
const NEXT = {
    READY: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED'],
    BLOCKED: ['READY', 'IN_PROGRESS', 'CANCELLED'],
    COMPLETED: [],
    FAILED: ['READY', 'IN_PROGRESS', 'CANCELLED'],
    CANCELLED: ['READY'],
};
const STATUS_TONE = {
    READY: 'NEUTRAL',
    IN_PROGRESS: 'MODERATE',
    BLOCKED: 'HIGH',
    COMPLETED: 'LOW',
    FAILED: 'CRITICAL',
    CANCELLED: 'NEUTRAL',
};
export function ActionsPage() {
    const { orgId } = useParams();
    const [actions, setActions] = useState(null);
    const [error, setError] = useState(null);
    const [pending, setPending] = useState(null);
    const load = useCallback(async () => {
        if (orgId === undefined)
            return;
        try {
            const response = await api.get(`/api/v1/actions/${orgId}`);
            setActions(response.actions);
        }
        catch (caught) {
            setError(caught instanceof ApiError ? caught : null);
        }
    }, [orgId]);
    useEffect(() => {
        void load();
    }, [load]);
    const move = useCallback(async (action, status) => {
        if (orgId === undefined)
            return;
        setPending(action.id);
        setError(null);
        try {
            await api.patch(`/api/v1/actions/${orgId}/${action.id}`, { status });
            await load();
        }
        catch (caught) {
            setError(caught instanceof ApiError ? caught : null);
        }
        finally {
            setPending(null);
        }
    }, [orgId, load]);
    if (error !== null && actions === null) {
        return _jsx(ErrorState, { title: "Could not load actions", message: error.message, requestId: error.requestId });
    }
    if (actions === null)
        return _jsx(Loading, { what: "actions" });
    const open = actions.filter((a) => a.status !== 'COMPLETED' && a.status !== 'CANCELLED');
    const closed = actions.filter((a) => a.status === 'COMPLETED' || a.status === 'CANCELLED');
    return (_jsxs("div", { className: "stack-lg", children: [_jsxs("header", { className: "page-head", children: [_jsx("h1", { style: { fontSize: 'var(--step-3)' }, children: "Actions" }), _jsxs("p", { className: "lede", children: [open.length === 0
                                ? 'Nothing is currently open.'
                                : `${open.length} open, ${closed.length} finished.`, ' ', "Actions created from a solution carry the step that verifies them."] })] }), error !== null && (_jsx("div", { className: "notice notice-error", role: "alert", children: error.message })), actions.length === 0 ? (_jsx(Empty, { title: "No actions yet", children: _jsx("p", { className: "muted", children: "Open a finding from the workspace and create an action plan from one of its options." }) })) : (_jsxs(_Fragment, { children: [_jsx(ActionTable, { title: "Open", rows: open, pending: pending, onMove: (action, status) => void move(action, status) }), closed.length > 0 && (_jsx(ActionTable, { title: "Finished", rows: closed, pending: pending, onMove: (action, status) => void move(action, status) }))] }))] }));
}
function ActionTable({ title, rows, pending, onMove, }) {
    if (rows.length === 0)
        return null;
    return (_jsxs("section", { children: [_jsxs("div", { className: "tier-head", children: [_jsx("h2", { className: "tier-title", children: title }), _jsxs("span", { className: "faint", style: { fontSize: 'var(--step--1)' }, children: [rows.length, " action", rows.length === 1 ? '' : 's'] })] }), _jsx("div", { className: "table-wrap", children: _jsxs("table", { className: "data", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Action" }), _jsx("th", { children: "Owner" }), _jsx("th", { children: "Priority" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Move to" })] }) }), _jsx("tbody", { children: rows.map((action) => (_jsxs("tr", { children: [_jsxs("td", { style: { minWidth: '18rem' }, children: [_jsx("strong", { children: action.title }), action.verification !== null && (_jsxs("span", { className: "verify-note", style: { display: 'block' }, children: ["Done when: ", action.verification] })), action.completedAt !== null && (_jsxs("span", { className: "verify-note", style: { display: 'block' }, children: ["Completed ", new Date(action.completedAt).toLocaleString()] }))] }), _jsx("td", { children: action.ownerHint ?? '—' }), _jsx("td", { children: _jsx("span", { className: "priority", children: action.priority }) }), _jsx("td", { children: _jsx("span", { className: `band band-${STATUS_TONE[action.status]}`, children: action.status.replace(/_/g, ' ') }) }), _jsx("td", { children: _jsx("div", { className: "row", style: { gap: 'var(--s-2)' }, children: NEXT[action.status].length === 0 ? (_jsx("span", { className: "faint", children: "\u2014" })) : (NEXT[action.status].map((status) => (_jsx("button", { type: "button", className: "btn btn-sm", disabled: pending === action.id, onClick: () => onMove(action, status), children: status.replace(/_/g, ' ').toLowerCase() }, status)))) }) })] }, action.id))) })] }) })] }));
}
