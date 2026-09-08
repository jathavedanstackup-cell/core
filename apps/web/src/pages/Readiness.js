import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Readiness.
 *
 * Whether the organization is actually prepared, check by check. The important
 * distinction on this page is between a check that failed and a check nobody
 * has answered — they are different problems and they get different marks.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Band, Empty, ErrorState, Loading } from '../components/Bits';
import { api, ApiError } from '../lib/api';
export function ReadinessPage() {
    const { orgId } = useParams();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [open, setOpen] = useState(null);
    useEffect(() => {
        if (orgId === undefined)
            return;
        let cancelled = false;
        void api
            .get(`/api/v1/${orgId}/readiness`)
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
    }, [orgId]);
    if (error !== null) {
        return _jsx(ErrorState, { title: "Could not load readiness", message: error.message, requestId: error.requestId });
    }
    if (data === null)
        return _jsx(Loading, { what: "readiness" });
    if (data.assessments.length === 0)
        return _jsx(Empty, { title: "Nothing recorded to assess yet." });
    return (_jsxs("div", { className: "stack-lg", children: [_jsxs("header", { className: "page-head", children: [_jsx("h1", { style: { fontSize: 'var(--step-3)' }, children: "Readiness" }), _jsx("p", { className: "lede", children: "Not whether a plan exists, but whether it would work. A check with no recorded answer counts as unknown, never as a pass." })] }), _jsxs("div", { className: "counts", children: [_jsxs("div", { className: "count", children: [_jsx("div", { className: "count-value", style: { color: 'var(--band-critical)' }, children: data.counts.CRITICAL }), _jsx("div", { className: "count-label", children: "Critical" })] }), _jsxs("div", { className: "count", children: [_jsx("div", { className: "count-value", style: { color: 'var(--band-high)' }, children: data.counts.AT_RISK }), _jsx("div", { className: "count-label", children: "At risk" })] }), _jsxs("div", { className: "count", children: [_jsx("div", { className: "count-value", style: { color: 'var(--band-moderate)' }, children: data.counts.PARTIAL }), _jsx("div", { className: "count-label", children: "Partial" })] }), _jsxs("div", { className: "count", children: [_jsx("div", { className: "count-value", style: { color: 'var(--band-low)' }, children: data.counts.READY }), _jsx("div", { className: "count-label", children: "Ready" })] })] }), _jsx("ul", { className: "finding-list", children: data.assessments.map((item) => {
                    const isOpen = open === item.subjectId;
                    return (_jsx("li", { children: _jsxs("div", { className: "finding", style: { cursor: 'default' }, children: [_jsxs("div", { className: "finding-top", children: [_jsx(Band, { value: item.state }), _jsx("span", { className: "finding-subject", children: item.subjectName }), _jsx("span", { className: "finding-kind", children: item.subjectKind.replace(/_/g, ' ') }), _jsxs("span", { className: "finding-kind", children: [item.passedCount, " of ", item.applicableCount, " checks pass", item.unknownCount > 0 ? `, ${item.unknownCount} unknown` : ''] }), _jsx("button", { type: "button", className: "btn btn-sm btn-quiet", style: { marginLeft: 'auto' }, "aria-expanded": isOpen, onClick: () => setOpen(isOpen ? null : item.subjectId), children: isOpen ? 'Hide checks' : 'Show checks' })] }), _jsx("p", { className: "finding-summary", children: item.summary }), isOpen && (_jsx("ul", { className: "checks", style: { marginTop: 'var(--s-4)' }, children: item.checks.map((check) => (_jsxs("li", { className: "check", children: [_jsx("span", { className: check.passed
                                                    ? 'check-mark check-pass'
                                                    : check.unknown
                                                        ? 'check-mark check-unknown'
                                                        : 'check-mark check-fail', "aria-hidden": "true", children: check.passed ? '✓' : check.unknown ? '?' : '✕' }), _jsxs("span", { children: [_jsx("strong", { children: check.label }), _jsx("span", { className: "verify-note", style: { display: 'block' }, children: check.detail })] })] }, check.code))) }))] }) }, item.subjectId));
                }) })] }));
}
