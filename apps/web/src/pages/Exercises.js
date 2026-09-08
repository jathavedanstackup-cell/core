import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Exercises.
 *
 * The page follows the real sequence: plan, start, record while it runs,
 * complete. Starting is what freezes the engine's expectation, and the
 * interface says so, because a rehearsal scored against a model that moved
 * afterwards would prove nothing.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Empty, ErrorState, Eyebrow, Loading } from '../components/Bits';
import { api, ApiError } from '../lib/api';
const EVENT_KINDS = ['decision', 'action', 'observation', 'gap', 'recovery', 'note'];
export function ExercisesPage() {
    const { orgId } = useParams();
    const [list, setList] = useState(null);
    const [entities, setEntities] = useState([]);
    const [error, setError] = useState(null);
    const [openId, setOpenId] = useState(null);
    const [detail, setDetail] = useState(null);
    const [title, setTitle] = useState('');
    const [picked, setPicked] = useState([]);
    const [eventKind, setEventKind] = useState('observation');
    const [eventText, setEventText] = useState('');
    const [actualMinutes, setActualMinutes] = useState('');
    const [busy, setBusy] = useState(false);
    const load = useCallback(async () => {
        if (orgId === undefined)
            return;
        try {
            const [exerciseResponse, entityResponse] = await Promise.all([
                api.get(`/api/v1/exercises/${orgId}`),
                api.get(`/api/v1/model/${orgId}/entities`),
            ]);
            setList(exerciseResponse.exercises);
            setEntities(entityResponse.entities);
        }
        catch (caught) {
            setError(caught instanceof ApiError ? caught : null);
        }
    }, [orgId]);
    useEffect(() => {
        void load();
    }, [load]);
    const openDetail = useCallback(async (id) => {
        if (orgId === undefined)
            return;
        if (openId === id) {
            setOpenId(null);
            return;
        }
        const response = await api.get(`/api/v1/exercises/${orgId}/${id}`);
        setDetail(response);
        setOpenId(id);
    }, [orgId, openId]);
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
    if (error !== null && list === null) {
        return _jsx(ErrorState, { title: "Could not load exercises", message: error.message, requestId: error.requestId });
    }
    if (list === null)
        return _jsx(Loading, { what: "exercises" });
    const nameOf = (ref) => entities.find((entity) => entity.ref === ref)?.name ?? ref;
    return (_jsxs("div", { className: "stack-lg", children: [_jsxs("header", { className: "page-head", children: [_jsx("h1", { style: { fontSize: 'var(--step-3)' }, children: "Exercises" }), _jsx("p", { className: "lede", children: "Rehearse a failure. C.O.R.E. records what it expects to happen when the exercise starts, you record what actually happens, and the review is the difference between the two." })] }), error !== null && (_jsx("div", { className: "notice notice-error", role: "alert", children: error.message })), _jsxs("section", { className: "card stack", children: [_jsx(Eyebrow, { children: "Plan an exercise" }), _jsx("input", { className: "plain-input", placeholder: "What are you rehearsing?", value: title, onChange: (event) => setTitle(event.target.value) }), _jsxs("div", { children: [_jsx("p", { className: "faint", style: { fontSize: 'var(--step--1)', marginBottom: 'var(--s-2)' }, children: "What becomes unavailable?" }), _jsx("div", { className: "row", children: entities
                                    .filter((entity) => entity.kind !== 'business_function')
                                    .slice(0, 24)
                                    .map((entity) => {
                                    const on = picked.includes(entity.ref);
                                    return (_jsx("button", { type: "button", className: on ? 'btn btn-sm btn-primary' : 'btn btn-sm', "aria-pressed": on, onClick: () => setPicked((previous) => previous.includes(entity.ref)
                                            ? previous.filter((ref) => ref !== entity.ref)
                                            : [...previous, entity.ref]), children: entity.name }, entity.ref));
                                }) })] }), _jsx("button", { type: "button", className: "btn btn-primary", disabled: busy || title.trim() === '' || picked.length === 0, onClick: () => void act(async () => {
                            await api.post(`/api/v1/exercises/${orgId}`, {
                                title: title.trim(),
                                scenarioRefs: picked,
                            });
                            setTitle('');
                            setPicked([]);
                        }), children: "Plan exercise" })] }), list.length === 0 ? (_jsx(Empty, { title: "No exercises yet.", children: _jsx("p", { className: "muted", children: "A plan nobody has rehearsed is an assumption, not a capability." }) })) : (_jsx("ul", { className: "finding-list", children: list.map((exercise) => (_jsx("li", { children: _jsxs("div", { className: "finding", style: { cursor: 'default' }, children: [_jsxs("div", { className: "finding-top", children: [_jsx("span", { className: `band band-${statusTone(exercise.status)}`, children: exercise.status }), _jsx("span", { className: "finding-subject", children: exercise.title }), _jsx("span", { className: "finding-kind", children: exercise.reference }), _jsx("button", { type: "button", className: "btn btn-sm btn-quiet", style: { marginLeft: 'auto' }, "aria-expanded": openId === exercise.id, onClick: () => void openDetail(exercise.id), children: openId === exercise.id ? 'Hide' : 'Open' })] }), _jsxs("p", { className: "finding-summary", children: ["Scenario: ", exercise.scenarioRefs.map(nameOf).join(', ')] }), exercise.expectedRecoveryMinutes !== null && (_jsxs("p", { className: "finding-rationale", children: ["Objective ", exercise.expectedRecoveryMinutes, " min", exercise.actualRecoveryMinutes !== null &&
                                        ` · actual ${exercise.actualRecoveryMinutes} min`] })), _jsxs("div", { className: "row", style: { marginTop: 'var(--s-3)' }, children: [exercise.status === 'PLANNED' && (_jsx("button", { type: "button", className: "btn btn-sm btn-primary", disabled: busy, onClick: () => void act(() => api.post(`/api/v1/exercises/${orgId}/${exercise.id}/start`)), children: "Start \u2014 this freezes the expectation" })), exercise.status === 'RUNNING' && (_jsxs(_Fragment, { children: [_jsx("input", { className: "plain-input", style: { flex: '1 1 16rem' }, placeholder: "Record what just happened", value: eventText, onChange: (event) => setEventText(event.target.value) }), _jsx("select", { className: "plain-input", style: { width: 'auto' }, value: eventKind, onChange: (event) => setEventKind(event.target.value), children: EVENT_KINDS.map((kind) => (_jsx("option", { value: kind, children: kind }, kind))) }), _jsx("button", { type: "button", className: "btn btn-sm", disabled: busy || eventText.trim() === '', onClick: () => void act(async () => {
                                                    await api.post(`/api/v1/exercises/${orgId}/${exercise.id}/events`, {
                                                        kind: eventKind,
                                                        description: eventText.trim(),
                                                    });
                                                    setEventText('');
                                                    if (openId === exercise.id)
                                                        await openDetail(exercise.id);
                                                }), children: "Record" }), _jsx("input", { className: "plain-input", style: { width: '9rem' }, inputMode: "numeric", placeholder: "recovery min", value: actualMinutes, onChange: (event) => setActualMinutes(event.target.value.replace(/\D/g, '')) }), _jsx("button", { type: "button", className: "btn btn-sm btn-primary", disabled: busy, onClick: () => void act(() => api.post(`/api/v1/exercises/${orgId}/${exercise.id}/complete`, {
                                                    ...(actualMinutes === ''
                                                        ? {}
                                                        : { actualRecoveryMinutes: Number(actualMinutes) }),
                                                })), children: "Complete and review" })] })), exercise.status === 'COMPLETED' && exercise.hasReview && (_jsxs(_Fragment, { children: [_jsx("a", { className: "btn btn-sm", href: `/api/v1/reports/${orgId}/preview/exercise?format=pdf&subject=${exercise.id}&download=true`, children: "Download review (PDF)" }), _jsx("button", { type: "button", className: "btn btn-sm", disabled: busy, onClick: () => void act(() => api.post(`/api/v1/exercises/${orgId}/${exercise.id}/improvements`)), children: "Accept improvements into the register" })] }))] }), openId === exercise.id && detail !== null && (_jsx(ExerciseDetail, { detail: detail }))] }) }, exercise.id))) }))] }));
}
function statusTone(status) {
    switch (status) {
        case 'RUNNING':
            return 'HIGH';
        case 'COMPLETED':
            return 'LOW';
        case 'CANCELLED':
            return 'NEUTRAL';
        default:
            return 'MODERATE';
    }
}
function ExerciseDetail({ detail, }) {
    const { review, timeline } = detail;
    return (_jsxs("div", { style: { marginTop: 'var(--s-5)' }, className: "stack", children: [review !== null && (_jsxs("div", { className: "reasons", children: [_jsx(Eyebrow, { children: "After-action review" }), _jsx("p", { style: { marginTop: 'var(--s-2)' }, children: review.summary }), _jsxs("div", { className: "counts", style: { marginTop: 'var(--s-4)' }, children: [_jsxs("div", { className: "count", children: [_jsx("div", { className: "count-value", children: review.timing.expectedMinutes ?? '—' }), _jsx("div", { className: "count-label", children: "Objective (min)" })] }), _jsxs("div", { className: "count", children: [_jsx("div", { className: "count-value", style: {
                                            color: review.timing.metTarget === false
                                                ? 'var(--band-critical)'
                                                : review.timing.metTarget === true
                                                    ? 'var(--band-low)'
                                                    : undefined,
                                        }, children: review.timing.actualMinutes ?? '—' }), _jsx("div", { className: "count-label", children: "Actual (min)" })] }), _jsxs("div", { className: "count", children: [_jsx("div", { className: "count-value", children: review.timing.metTarget === null
                                            ? '—'
                                            : review.timing.metTarget
                                                ? 'Met'
                                                : 'Missed' }), _jsx("div", { className: "count-label", children: "Objective" })] })] }), [
                        ['What worked', review.whatWorked],
                        ['What did not', review.whatDidNot],
                        ['What surprised us', review.surprises],
                        ['What was missing', review.missing],
                    ].map(([heading, items]) => items.length === 0 ? null : (_jsxs("div", { style: { marginTop: 'var(--s-4)' }, children: [_jsx(Eyebrow, { children: heading }), _jsx("ul", { style: { marginTop: 'var(--s-2)', paddingLeft: '1.1rem' }, className: "muted", children: items.map((item) => (_jsx("li", { children: item }, item))) })] }, heading))), review.recommendedImprovements.length > 0 && (_jsxs("div", { style: { marginTop: 'var(--s-4)' }, children: [_jsx(Eyebrow, { children: "Recommended improvements" }), _jsx("ol", { className: "action-steps", children: review.recommendedImprovements.map((item) => (_jsxs("li", { className: "action-step", children: [_jsx("span", { className: "priority", children: item.priority }), _jsxs("span", { children: [_jsx("span", { children: item.title }), _jsx("span", { className: "verify-note", children: item.expectedBenefit })] })] }, item.title))) })] }))] })), timeline.length > 0 && (_jsxs("div", { children: [_jsx(Eyebrow, { children: "What happened \u2014 oldest first" }), _jsx("ul", { className: "timeline", style: { marginTop: 'var(--s-2)' }, children: timeline.map((event) => (_jsxs("li", { children: [_jsx("span", { className: "timeline-when", children: new Date(event.occurredAt).toLocaleString() }), _jsxs("span", { children: [_jsx("span", { className: "timeline-kind", children: event.kind }), _jsx("span", { style: { display: 'block' }, children: event.description })] })] }, event.id))) })] }))] }));
}
