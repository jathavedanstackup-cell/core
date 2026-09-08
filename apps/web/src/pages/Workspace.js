import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The workspace.
 *
 * Answers four questions in order, top to bottom: what matters, what is at
 * risk, what needs attention, what to do. The single most important sentence
 * gets the most space; everything else is progressively disclosed underneath.
 *
 * There is no KPI wall. A row of large numbers would look authoritative and
 * say very little.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Band, Empty, ErrorState, Eyebrow, Loading } from '../components/Bits';
import { api, ApiError } from '../lib/api';
const TIER_COPY = {
    FIX_FIRST: {
        title: 'Fix first',
        blurb: 'The highest value work available to you right now.',
    },
    FIX_NEXT: {
        title: 'Fix next',
        blurb: 'Worth doing, once the first list is moving.',
    },
    MONITOR: {
        title: 'Monitor',
        blurb: 'Recorded and watched. No action needed today.',
    },
};
export function WorkspacePage() {
    const { orgId } = useParams();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [reload, setReload] = useState(0);
    useEffect(() => {
        if (orgId === undefined)
            return;
        let cancelled = false;
        setData(null);
        setError(null);
        void api
            .get(`/api/v1/${orgId}/assessment`)
            .then((response) => {
            if (!cancelled)
                setData(response);
        })
            .catch((caught) => {
            if (!cancelled)
                setError(caught instanceof ApiError ? caught : null);
        });
        return () => {
            cancelled = true;
        };
    }, [orgId, reload]);
    if (error !== null) {
        return (_jsx(ErrorState, { title: "Could not load the assessment", message: error.message, requestId: error.requestId, onRetry: () => setReload((n) => n + 1) }));
    }
    if (data === null)
        return _jsx(Loading, { what: "your organization" });
    const first = data.tiers.FIX_FIRST[0];
    const errors = data.dataIssues.filter((issue) => issue.severity === 'error');
    const warnings = data.dataIssues.filter((issue) => issue.severity === 'warning');
    if (data.model.entityCount === 0) {
        return (_jsx(Empty, { title: "Nothing recorded yet", children: _jsx("p", { className: "muted", children: "C.O.R.E. analyses what your organization has written down. Add the things you depend on \u2014 people, systems, suppliers, places \u2014 and how they connect, and the analysis follows." }) }));
    }
    return (_jsxs("div", { className: "stack-lg", children: [_jsxs("section", { className: "headline", children: [_jsx(Eyebrow, { children: "What matters right now" }), first === undefined ? (_jsx("p", { className: "headline-text", style: { marginTop: 'var(--s-3)' }, children: "Nothing in this organization currently rates above moderate risk." })) : (_jsxs(_Fragment, { children: [_jsx("p", { className: "headline-text", style: { marginTop: 'var(--s-3)' }, children: first.summary }), _jsx("p", { className: "headline-sub", children: first.rationale }), _jsx("p", { style: { marginTop: 'var(--s-4)' }, children: _jsx(Link, { className: "btn btn-primary", to: `finding/${encodeURIComponent(first.id)}`, children: "See the options" }) })] }))] }), _jsxs("section", { children: [_jsx(Eyebrow, { children: "What is at risk" }), _jsxs("div", { className: "counts", style: { marginTop: 'var(--s-3)' }, children: [_jsx(Count, { value: data.summary.critical, label: "Critical", tone: "CRITICAL" }), _jsx(Count, { value: data.summary.high, label: "High", tone: "HIGH" }), _jsx(Count, { value: data.summary.moderate, label: "Moderate", tone: "MODERATE" }), _jsx(Count, { value: data.summary.low, label: "Low", tone: "LOW" }), _jsx(Count, { value: data.model.entityCount, label: "Things recorded" }), _jsx(Count, { value: data.model.dependencyCount, label: "Dependencies" })] })] }), (errors.length > 0 || warnings.length > 0) && (_jsxs("section", { className: errors.length > 0 ? 'notice notice-error' : 'notice notice-warn', children: [_jsx("strong", { children: errors.length > 0
                            ? `${errors.length} problem(s) in your organization data`
                            : `${warnings.length} thing(s) worth checking` }), _jsx("ul", { style: { marginTop: 'var(--s-2)', paddingLeft: '1.1rem' }, children: [...errors, ...warnings].slice(0, 5).map((issue) => (_jsx("li", { children: issue.message }, issue.code + issue.subjectId))) })] })), ['FIX_FIRST', 'FIX_NEXT', 'MONITOR'].map((tier) => {
                const items = data.tiers[tier];
                if (items.length === 0)
                    return null;
                return (_jsxs("section", { className: "tier", children: [_jsxs("div", { className: "tier-head", children: [_jsx("h2", { className: "tier-title", children: TIER_COPY[tier].title }), _jsx("span", { className: "faint", style: { fontSize: 'var(--step--1)' }, children: TIER_COPY[tier].blurb })] }), _jsx("ul", { className: "finding-list", children: items.map((finding) => (_jsx("li", { children: _jsx(FindingRow, { finding: finding }) }, finding.id))) })] }, tier));
            }), _jsxs("p", { className: "faint", style: { fontSize: 'var(--step--1)' }, children: ["Assessed ", new Date(data.generatedAt).toLocaleString(), " from ", data.model.entityCount, " recorded items. Only recorded dependencies are considered."] })] }));
}
function FindingRow({ finding }) {
    return (_jsxs(Link, { className: "finding", to: `finding/${encodeURIComponent(finding.id)}`, children: [_jsxs("div", { className: "finding-top", children: [_jsx(Band, { value: finding.risk.band }), _jsx("span", { className: "finding-subject", children: finding.subjectName }), _jsx("span", { className: "finding-kind", children: finding.subjectKind.replace(/_/g, ' ') }), finding.criticalDependents > 0 && (_jsxs("span", { className: "tag", children: [finding.criticalDependents, " critical function", finding.criticalDependents === 1 ? '' : 's', " affected"] }))] }), _jsx("p", { className: "finding-summary", children: finding.summary }), _jsx("p", { className: "finding-rationale", children: finding.rationale })] }));
}
function Count({ value, label, tone, }) {
    return (_jsxs("div", { className: "count", children: [_jsx("div", { className: "count-value", style: tone === undefined ? undefined : { color: `var(--band-${tone.toLowerCase()})` }, children: value }), _jsx("div", { className: "count-label", children: label })] }));
}
