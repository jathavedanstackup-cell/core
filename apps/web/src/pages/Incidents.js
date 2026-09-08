import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Incidents and their timelines.
 *
 * The timeline runs oldest first and is ordered by when things actually
 * happened, not when somebody typed them, so a late entry lands in its true
 * place. Times are shown absolutely; "2 hours ago" is not a fact you can
 * reconstruct a decision from.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Empty, ErrorState, Eyebrow, Loading } from '../components/Bits';
import { api, ApiError } from '../lib/api';
const STATUSES = ['OPEN', 'INVESTIGATING', 'CONTAINED', 'RECOVERING', 'RESOLVED', 'CLOSED'];
const SEVERITY_TONE = {
    SEV1: 'CRITICAL',
    SEV2: 'HIGH',
    SEV3: 'MODERATE',
    SEV4: 'LOW',
};
export function IncidentsPage() {
    const { orgId } = useParams();
    const [incidents, setIncidents] = useState(null);
    const [openId, setOpenId] = useState(null);
    const [timeline, setTimeline] = useState([]);
    const [error, setError] = useState(null);
    const [title, setTitle] = useState('');
    const [severity, setSeverity] = useState('SEV3');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const load = useCallback(async () => {
        if (orgId === undefined)
            return;
        try {
            const response = await api.get(`/api/v1/incidents/${orgId}`);
            setIncidents(response.incidents);
        }
        catch (caught) {
            setError(caught instanceof ApiError ? caught : null);
        }
    }, [orgId]);
    useEffect(() => {
        void load();
    }, [load]);
    const openIncident = useCallback(async (id) => {
        if (orgId === undefined)
            return;
        if (openId === id) {
            setOpenId(null);
            return;
        }
        const response = await api.get(`/api/v1/incidents/${orgId}/${id}`);
        setTimeline(response.timeline);
        setOpenId(id);
    }, [orgId, openId]);
    const create = useCallback(async (event) => {
        event.preventDefault();
        if (orgId === undefined || busy || title.trim() === '')
            return;
        setBusy(true);
        setError(null);
        try {
            await api.post(`/api/v1/incidents/${orgId}`, { title: title.trim(), severity });
            setTitle('');
            await load();
        }
        catch (caught) {
            setError(caught instanceof ApiError ? caught : null);
        }
        finally {
            setBusy(false);
        }
    }, [orgId, busy, title, severity, load]);
    const changeStatus = useCallback(async (incident, status) => {
        if (orgId === undefined)
            return;
        await api.patch(`/api/v1/incidents/${orgId}/${incident.id}`, { status });
        await load();
        if (openId === incident.id) {
            const response = await api.get(`/api/v1/incidents/${orgId}/${incident.id}`);
            setTimeline(response.timeline);
        }
    }, [orgId, load, openId]);
    const addEvent = useCallback(async (incidentId) => {
        if (orgId === undefined || note.trim() === '')
            return;
        await api.post(`/api/v1/incidents/${orgId}/${incidentId}/events`, {
            kind: 'note',
            description: note.trim(),
        });
        setNote('');
        const response = await api.get(`/api/v1/incidents/${orgId}/${incidentId}`);
        setTimeline(response.timeline);
    }, [orgId, note]);
    if (error !== null && incidents === null) {
        return _jsx(ErrorState, { title: "Could not load incidents", message: error.message, requestId: error.requestId });
    }
    if (incidents === null)
        return _jsx(Loading, { what: "incidents" });
    return (_jsxs("div", { className: "stack-lg", children: [_jsxs("header", { className: "page-head", children: [_jsx("h1", { style: { fontSize: 'var(--step-3)' }, children: "Incidents" }), _jsx("p", { className: "lede", children: "Every incident keeps a chronological record of what happened and when, so the response can be reviewed afterwards rather than remembered." })] }), _jsxs("form", { className: "card row", onSubmit: (event) => void create(event), children: [_jsx("input", { style: {
                            flex: '1 1 18rem',
                            padding: '0.6rem 0.75rem',
                            border: '1px solid var(--line-strong)',
                            borderRadius: 'var(--radius-sm)',
                            background: 'var(--paper-raised)',
                        }, placeholder: "What is happening?", value: title, onChange: (event) => setTitle(event.target.value) }), _jsxs("select", { value: severity, onChange: (event) => setSeverity(event.target.value), style: {
                            padding: '0.6rem 0.75rem',
                            border: '1px solid var(--line-strong)',
                            borderRadius: 'var(--radius-sm)',
                            background: 'var(--paper-raised)',
                        }, children: [_jsx("option", { value: "SEV1", children: "SEV1 \u2014 critical" }), _jsx("option", { value: "SEV2", children: "SEV2 \u2014 major" }), _jsx("option", { value: "SEV3", children: "SEV3 \u2014 moderate" }), _jsx("option", { value: "SEV4", children: "SEV4 \u2014 minor" })] }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: busy || title.trim() === '', children: "Declare incident" })] }), error !== null && (_jsx("div", { className: "notice notice-error", role: "alert", children: error.message })), incidents.length === 0 ? (_jsx(Empty, { title: "No incidents recorded.", children: _jsx("p", { className: "muted", children: "That is the preferred state." }) })) : (_jsx("ul", { className: "finding-list", children: incidents.map((incident) => (_jsx("li", { children: _jsxs("div", { className: "finding", style: { cursor: 'default' }, children: [_jsxs("div", { className: "finding-top", children: [_jsx("span", { className: `band band-${SEVERITY_TONE[incident.severity]}`, children: incident.severity }), _jsx("span", { className: "finding-subject", children: incident.title }), _jsx("span", { className: "finding-kind", children: incident.reference }), _jsx("span", { className: "tag", children: incident.status.toLowerCase() }), _jsx("button", { type: "button", className: "btn btn-sm btn-quiet", style: { marginLeft: 'auto' }, "aria-expanded": openId === incident.id, onClick: () => void openIncident(incident.id), children: openId === incident.id ? 'Hide timeline' : 'Timeline' })] }), _jsxs("p", { className: "finding-rationale", children: ["Started ", new Date(incident.startedAt).toLocaleString(), incident.resolvedAt !== null &&
                                        ` · resolved ${new Date(incident.resolvedAt).toLocaleString()}`] }), _jsx("div", { className: "row", style: { marginTop: 'var(--s-3)' }, children: STATUSES.filter((status) => status !== incident.status).map((status) => (_jsx("button", { type: "button", className: "btn btn-sm", onClick: () => void changeStatus(incident, status), children: status.toLowerCase() }, status))) }), openId === incident.id && (_jsxs("div", { style: { marginTop: 'var(--s-5)' }, children: [_jsx(Eyebrow, { children: "Timeline \u2014 oldest first" }), _jsx("ul", { className: "timeline", style: { marginTop: 'var(--s-3)' }, children: timeline.map((event) => (_jsxs("li", { children: [_jsx("span", { className: "timeline-when", children: new Date(event.occurredAt).toLocaleString() }), _jsxs("span", { children: [_jsx("span", { className: "timeline-kind", children: event.kind }), _jsx("span", { style: { display: 'block' }, children: event.description }), event.actor !== null && (_jsxs("span", { className: "verify-note", children: ["Recorded by ", event.actor.name] }))] })] }, event.id))) }), _jsxs("div", { className: "row", style: { marginTop: 'var(--s-4)' }, children: [_jsx("input", { style: {
                                                    flex: '1 1 16rem',
                                                    padding: '0.5rem 0.7rem',
                                                    border: '1px solid var(--line-strong)',
                                                    borderRadius: 'var(--radius-sm)',
                                                    background: 'var(--paper-raised)',
                                                }, placeholder: "Add to the timeline", value: note, onChange: (event) => setNote(event.target.value) }), _jsx("button", { type: "button", className: "btn btn-sm", disabled: note.trim() === '', onClick: () => void addEvent(incident.id), children: "Record" })] })] }))] }) }, incident.id))) }))] }));
}
