import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function Band({ value }) {
    const label = value.replace(/_/g, ' ');
    return _jsx("span", { className: `band band-${value}`, children: label });
}
export function Eyebrow({ children }) {
    return _jsx("p", { className: "eyebrow", children: children });
}
export function Loading({ what }) {
    return (_jsxs("div", { className: "state-block", role: "status", children: [_jsx("span", { className: "spinner", "aria-hidden": "true" }), _jsxs("p", { className: "muted", children: ["Loading ", what, "\u2026"] })] }));
}
export function ErrorState({ title, message, requestId, onRetry, }) {
    return (_jsxs("div", { className: "state-block notice-error", role: "alert", children: [_jsx("h3", { children: title }), _jsx("p", { children: message }), requestId !== undefined && (_jsxs("p", { className: "faint", style: { fontSize: 'var(--step--1)' }, children: ["Reference ", _jsx("code", { children: requestId })] })), onRetry !== undefined && (_jsx("button", { type: "button", className: "btn btn-sm", onClick: onRetry, children: "Try again" }))] }));
}
export function Empty({ title, children }) {
    return (_jsxs("div", { className: "state-block", children: [_jsx("h3", { children: title }), children] }));
}
/**
 * The reasons behind a risk band.
 *
 * This is the component that makes the product's central claim true: a band is
 * never shown without the ability to see exactly why it was reached.
 */
export function RiskReasons({ reasons, score, maxScore, band, overrideRule, }) {
    return (_jsxs("div", { className: "reasons", children: [_jsxs("div", { className: "row-between", children: [_jsxs(Eyebrow, { children: ["Why this is ", band.toLowerCase()] }), _jsxs("span", { className: "faint", style: { fontSize: 'var(--step--1)' }, children: [score, " of ", maxScore, " points"] })] }), _jsx("ul", { className: "reason-list", children: reasons.map((reason) => (_jsxs("li", { children: [_jsx("span", { className: `reason-points ${reason.contribution > 0 ? 'up' : reason.contribution < 0 ? 'down' : 'flat'}`, children: reason.contribution > 0 ? `+${reason.contribution}` : reason.contribution }), _jsxs("span", { className: "reason-body", children: [_jsx("span", { children: reason.statement }), _jsx(ConfidenceTag, { value: reason.confidence })] })] }, reason.code + reason.statement.slice(0, 24)))) }), overrideRule !== undefined && (_jsxs("p", { className: "reason-override", children: [_jsx("strong", { children: "Rule applied:" }), " ", overrideRule] }))] }));
}
/**
 * How much the system actually knows about a statement.
 *
 * Shown next to every reason because presenting an assumption as a fact is the
 * failure mode this product most needs to avoid.
 */
export function ConfidenceTag({ value }) {
    const explanation = {
        KNOWN: 'Recorded in your organization data.',
        ESTIMATED: 'Derived from what depends on this, not stated directly.',
        ASSUMED: 'Assumed in the absence of a recorded answer.',
        UNKNOWN: 'Nobody has recorded an answer to this.',
        UNVERIFIED: 'Recorded, but out of date and not re-confirmed.',
    };
    return (_jsx("span", { className: `confidence confidence-${value}`, title: explanation[value], children: value.toLowerCase() }));
}
export function TradeOffBar({ label, value, }) {
    const steps = { LOW: 1, MEDIUM: 2, HIGH: 3 }[value];
    return (_jsxs("div", { className: "tradeoff", children: [_jsx("span", { className: "tradeoff-label", children: label }), _jsx("span", { className: "tradeoff-pips", "aria-label": `${label}: ${value.toLowerCase()}`, children: [1, 2, 3].map((pip) => (_jsx("span", { className: pip <= steps ? 'pip on' : 'pip' }, pip))) }), _jsx("span", { className: "tradeoff-value", children: value.toLowerCase() })] }));
}
