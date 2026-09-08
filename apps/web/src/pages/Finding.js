import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * One weakness, in full: the problem, why it matters, why it scored as it did,
 * the options, and the plan.
 *
 * The recommended option is marked but never the only one shown, and its
 * rationale is stated so a reader can disagree with the reasoning rather than
 * just the answer.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Band, ErrorState, Eyebrow, Loading, RiskReasons, TradeOffBar } from '../components/Bits';
import { api, ApiError } from '../lib/api';
export function FindingPage() {
    const { orgId, findingId } = useParams();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [planned, setPlanned] = useState(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (orgId === undefined || findingId === undefined)
            return;
        let cancelled = false;
        setData(null);
        setError(null);
        void api
            .get(`/api/v1/${orgId}/solutions?finding=${encodeURIComponent(findingId)}`)
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
    }, [orgId, findingId]);
    const createPlan = useCallback(async (optionId) => {
        if (orgId === undefined || findingId === undefined || busy)
            return;
        setBusy(true);
        try {
            const result = await api.post(`/api/v1/actions/${orgId}/from-solution`, { findingId, optionId });
            setPlanned({ count: result.actions.length, option: result.option.title });
        }
        catch (caught) {
            setError(caught instanceof ApiError ? caught : null);
        }
        finally {
            setBusy(false);
        }
    }, [orgId, findingId, busy]);
    if (error !== null) {
        return (_jsx(ErrorState, { title: "Could not load this finding", message: error.message, requestId: error.requestId }));
    }
    if (data === null)
        return _jsx(Loading, { what: "this finding" });
    const { finding, solutions } = data;
    const recommended = solutions.options.find((o) => o.id === solutions.recommendedOptionId);
    return (_jsxs("div", { className: "stack-lg", children: [_jsx("p", { children: _jsx(Link, { to: "..", relative: "path", className: "btn btn-quiet btn-sm", children: "\u2190 Back to workspace" }) }), _jsxs("header", { className: "page-head", style: { maxWidth: '52rem' }, children: [_jsxs("div", { className: "row", children: [_jsx(Band, { value: finding.risk.band }), _jsx("span", { className: "faint", children: finding.subjectKind.replace(/_/g, ' ') })] }), _jsx("h1", { style: { fontSize: 'var(--step-3)' }, children: finding.subjectName }), _jsx("p", { className: "lede", children: solutions.problem }), _jsx("p", { className: "muted", children: solutions.whyItMatters })] }), _jsx(RiskReasons, { reasons: finding.risk.reasons, score: finding.risk.score, maxScore: finding.risk.maxScore, band: finding.risk.band, overrideRule: finding.risk.overrideRule }), _jsxs("section", { children: [_jsxs("div", { className: "tier-head", children: [_jsx("h2", { className: "tier-title", children: "What you can do" }), _jsxs("span", { className: "faint", style: { fontSize: 'var(--step--1)' }, children: [solutions.options.length, " option", solutions.options.length === 1 ? '' : 's', ", most effective first"] })] }), _jsx("div", { className: "stack", children: solutions.options.map((option) => (_jsx(OptionCard, { option: option, recommended: option.id === solutions.recommendedOptionId, rationale: option.id === solutions.recommendedOptionId
                                ? solutions.recommendationRationale
                                : undefined, onPlan: () => void createPlan(option.id), busy: busy }, option.id))) })] }), planned !== null && (_jsxs("div", { className: "notice", style: { borderColor: 'var(--accent-line)', background: 'var(--accent-soft)' }, children: [_jsxs("strong", { children: [planned.count, " action(s) created"] }), " for \u201C", planned.option, "\u201D.", ' ', _jsx(Link, { to: "../actions", relative: "path", children: "Track them on the actions page" }), "."] })), recommended !== undefined && (_jsx("p", { className: "faint", style: { fontSize: 'var(--step--1)', maxWidth: 'var(--reading-width)' }, children: "These options are generated from what your organization has recorded. They are a starting point for a decision, not the decision itself." }))] }));
}
function OptionCard({ option, recommended, rationale, onPlan, busy, }) {
    const [open, setOpen] = useState(recommended);
    return (_jsxs("article", { className: recommended ? 'option recommended' : 'option', children: [_jsxs("div", { className: "option-head", children: [_jsx("h3", { className: "option-title", children: option.title }), recommended && _jsx("span", { className: "recommend-flag", children: "Recommended" })] }), _jsx("p", { className: "muted", style: { marginTop: 'var(--s-3)', maxWidth: '52rem' }, children: option.description }), rationale !== undefined && (_jsxs("p", { style: { marginTop: 'var(--s-3)', fontSize: 'var(--step--1)' }, children: [_jsx("strong", { children: "Why this one:" }), " ", rationale] })), _jsxs("div", { className: "tradeoffs", children: [_jsx(TradeOffBar, { label: "Cost", value: option.tradeOffs.cost }), _jsx(TradeOffBar, { label: "Effort", value: option.tradeOffs.effort }), _jsx(TradeOffBar, { label: "Time", value: option.tradeOffs.time }), _jsx(TradeOffBar, { label: "Disruption", value: option.tradeOffs.disruption }), _jsxs("div", { className: "tradeoff", children: [_jsx("span", { className: "tradeoff-label", children: "Removes" }), _jsx("span", { className: "tradeoff-pips", "aria-label": `Removes ${option.riskReduction} of 3`, children: [1, 2, 3].map((pip) => (_jsx("span", { className: pip <= option.riskReduction ? 'pip on' : 'pip' }, pip))) }), _jsxs("span", { className: "tradeoff-value", children: [option.riskReduction, " of 3"] })] })] }), _jsxs("div", { className: "row", style: { marginTop: 'var(--s-4)' }, children: [_jsx("button", { type: "button", className: "btn btn-sm", onClick: () => setOpen((v) => !v), children: open ? 'Hide the plan' : 'Show the plan' }), _jsx("button", { type: "button", className: "btn btn-sm btn-primary", onClick: onPlan, disabled: busy, children: busy ? 'Creating…' : 'Create action plan' })] }), open && (_jsxs("div", { style: { marginTop: 'var(--s-4)' }, children: [option.preconditions.length > 0 && (_jsxs(_Fragment, { children: [_jsx(Eyebrow, { children: "This assumes" }), _jsx("ul", { style: { margin: 'var(--s-2) 0 var(--s-4)', paddingLeft: '1.1rem' }, className: "muted", children: option.preconditions.map((item) => (_jsx("li", { children: item }, item))) })] })), _jsx(Eyebrow, { children: "Steps" }), _jsx("ol", { className: "action-steps", children: option.actions.map((action) => (_jsxs("li", { className: "action-step", children: [_jsx("span", { className: "priority", children: action.priority }), _jsxs("span", { children: [_jsx("span", { children: action.title }), _jsxs("span", { className: "verify-note", children: ["Owner: ", action.ownerHint, " \u00B7 Done when: ", action.verification] })] })] }, action.title))) }), _jsxs("p", { className: "verify-note", style: { marginTop: 'var(--s-4)' }, children: [_jsx("strong", { children: "The weakness is gone when:" }), " ", option.verification] })] }))] }));
}
