import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The improvement register.
 *
 * Kept separate from actions on purpose. An action closes a weakness now; an
 * improvement reduces the chance of it recurring. Mixing them makes the action
 * list — which should be short and current — fill with long-horizon work.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Empty, ErrorState, Loading } from '../components/Bits';
import { api, ApiError } from '../lib/api';
/** Mirrors the server's state machine, so no impossible move is offered. */
const NEXT = {
    PROPOSED: ['ACCEPTED', 'DECLINED'],
    ACCEPTED: ['IN_PROGRESS', 'DECLINED'],
    IN_PROGRESS: ['COMPLETED', 'ACCEPTED', 'DECLINED'],
    COMPLETED: [],
    DECLINED: ['PROPOSED'],
};
const TONE = {
    PROPOSED: 'NEUTRAL',
    ACCEPTED: 'MODERATE',
    IN_PROGRESS: 'HIGH',
    COMPLETED: 'LOW',
    DECLINED: 'NEUTRAL',
};
export function ImprovementsPage() {
    const { orgId } = useParams();
    const [items, setItems] = useState(null);
    const [error, setError] = useState(null);
    const [title, setTitle] = useState('');
    const [benefit, setBenefit] = useState('');
    const [busy, setBusy] = useState(false);
    const load = useCallback(async () => {
        if (orgId === undefined)
            return;
        try {
            const response = await api.get(`/api/v1/improvements/${orgId}`);
            setItems(response.improvements);
        }
        catch (caught) {
            setError(caught instanceof ApiError ? caught : null);
        }
    }, [orgId]);
    useEffect(() => {
        void load();
    }, [load]);
    const act = useCallback(async (work) => {
        if (busy)
            return;
        setBusy(true);
        setError(null);
        try {
            await work();
            await load();
        }
        catch (caught) {
            setError(caught instanceof ApiError ? caught : null);
        }
        finally {
            setBusy(false);
        }
    }, [busy, load]);
    if (error !== null && items === null) {
        return (_jsx(ErrorState, { title: "Could not load improvements", message: error.message, requestId: error.requestId }));
    }
    if (items === null)
        return _jsx(Loading, { what: "the improvement register" });
    const open = items.filter((item) => item.status !== 'COMPLETED' && item.status !== 'DECLINED');
    return (_jsxs("div", { className: "stack-lg", children: [_jsxs("header", { className: "page-head", children: [_jsx("h1", { style: { fontSize: 'var(--step-3)' }, children: "Improvements" }), _jsxs("p", { className: "lede", children: ["Preventive work: making a failure less likely next time, rather than closing a weakness now. ", open.length, " open of ", items.length, " recorded."] })] }), error !== null && (_jsx("div", { className: "notice notice-error", role: "alert", children: error.message })), _jsxs("form", { className: "card row", onSubmit: (event) => {
                    event.preventDefault();
                    void act(async () => {
                        await api.post(`/api/v1/improvements/${orgId}`, {
                            title: title.trim(),
                            ...(benefit.trim() === '' ? {} : { expectedBenefit: benefit.trim() }),
                        });
                        setTitle('');
                        setBenefit('');
                    });
                }, children: [_jsx("input", { className: "plain-input", style: { flex: '2 1 18rem' }, placeholder: "What should change?", value: title, onChange: (event) => setTitle(event.target.value) }), _jsx("input", { className: "plain-input", style: { flex: '2 1 16rem' }, placeholder: "Expected benefit", value: benefit, onChange: (event) => setBenefit(event.target.value) }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy || title.trim() === '', children: "Add" })] }), items.length === 0 ? (_jsx(Empty, { title: "Nothing recorded yet.", children: _jsx("p", { className: "muted", children: "Completing an exercise proposes improvements from what it found; accept them from the exercise page to bring them here." }) })) : (_jsx("div", { className: "table-wrap", children: _jsxs("table", { className: "data", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Priority" }), _jsx("th", { children: "Improvement" }), _jsx("th", { children: "Status" }), _jsx("th", { children: "Move to" })] }) }), _jsx("tbody", { children: items.map((item) => (_jsxs("tr", { children: [_jsx("td", { children: _jsx("span", { className: "priority", children: item.priority }) }), _jsxs("td", { style: { minWidth: '20rem' }, children: [_jsx("strong", { children: item.title }), item.expectedBenefit !== null && (_jsxs("span", { className: "verify-note", style: { display: 'block' }, children: ["Benefit: ", item.expectedBenefit] })), item.verification !== null && (_jsxs("span", { className: "verify-note", style: { display: 'block' }, children: ["Verified by: ", item.verification] })), item.sourceExerciseId !== null && (_jsx("span", { className: "tag", style: { marginTop: 'var(--s-2)', display: 'inline-block' }, children: "from an exercise" }))] }), _jsxs("td", { children: [_jsx("span", { className: `band band-${TONE[item.status]}`, children: item.status.replace(/_/g, ' ') }), item.completedAt !== null && (_jsx("span", { className: "verify-note", style: { display: 'block' }, children: new Date(item.completedAt).toLocaleDateString() }))] }), _jsx("td", { children: _jsx("div", { className: "row", style: { gap: 'var(--s-2)' }, children: NEXT[item.status].length === 0 ? (_jsx("span", { className: "faint", children: "\u2014" })) : (NEXT[item.status].map((status) => (_jsx("button", { type: "button", className: "btn btn-sm", disabled: busy, onClick: () => void act(() => api.patch(`/api/v1/improvements/${orgId}/${item.id}`, { status })), children: status.replace(/_/g, ' ').toLowerCase() }, status)))) }) })] }, item.id))) })] }) }))] }));
}
