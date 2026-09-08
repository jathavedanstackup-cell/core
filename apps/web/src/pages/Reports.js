import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Reports.
 *
 * Generating stores the document, so a report handed to a board can be reopened
 * exactly as issued. Previewing does not store anything, which is what you want
 * before committing a document other people will be given.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Empty, ErrorState, Eyebrow, Loading } from '../components/Bits';
import { api, ApiError } from '../lib/api';
const FORMATS = [
    { id: 'pdf', label: 'PDF' },
    { id: 'html', label: 'HTML' },
    { id: 'csv', label: 'CSV' },
    { id: 'json', label: 'JSON' },
];
export function ReportsPage() {
    const { orgId } = useParams();
    const [catalogue, setCatalogue] = useState(null);
    const [stored, setStored] = useState([]);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(null);
    const load = useCallback(async () => {
        if (orgId === undefined)
            return;
        try {
            const [catalogueResponse, storedResponse] = await Promise.all([
                api.get(`/api/v1/reports/${orgId}/catalogue`),
                api.get(`/api/v1/reports/${orgId}`),
            ]);
            setCatalogue(catalogueResponse.reports);
            setStored(storedResponse.reports);
        }
        catch (caught) {
            setError(caught instanceof ApiError ? caught : null);
        }
    }, [orgId]);
    useEffect(() => {
        void load();
    }, [load]);
    const generate = useCallback(async (kind) => {
        if (orgId === undefined)
            return;
        setBusy(kind);
        setError(null);
        try {
            await api.post(`/api/v1/reports/${orgId}/${kind}`);
            await load();
        }
        catch (caught) {
            setError(caught instanceof ApiError ? caught : null);
        }
        finally {
            setBusy(null);
        }
    }, [orgId, load]);
    if (error !== null && catalogue === null) {
        return _jsx(ErrorState, { title: "Could not load reports", message: error.message, requestId: error.requestId });
    }
    if (catalogue === null)
        return _jsx(Loading, { what: "reports" });
    // Reports about one specific thing are produced from that thing's own page,
    // where the subject is unambiguous.
    const generalReports = catalogue.filter((entry) => !entry.needsSubject);
    return (_jsxs("div", { className: "stack-lg", children: [_jsxs("header", { className: "page-head", children: [_jsx("h1", { style: { fontSize: 'var(--step-3)' }, children: "Reports" }), _jsx("p", { className: "lede", children: "Built from your recorded data at the moment you generate them. Each states its own assumptions, so a reader knows what the document does and does not claim." })] }), error !== null && (_jsx("div", { className: "notice notice-error", role: "alert", children: error.message })), _jsxs("section", { children: [_jsx("div", { className: "tier-head", children: _jsx("h2", { className: "tier-title", children: "Available" }) }), _jsx("div", { className: "grid-2", children: generalReports.map((entry) => (_jsxs("article", { className: "card", children: [_jsx("h3", { style: { fontSize: 'var(--step-1)' }, children: entry.title }), _jsx("p", { className: "muted", style: { marginTop: 'var(--s-2)', fontSize: 'var(--step--1)' }, children: entry.description }), _jsxs("div", { className: "row", style: { marginTop: 'var(--s-4)' }, children: [_jsx("button", { type: "button", className: "btn btn-sm btn-primary", disabled: busy !== null, onClick: () => void generate(entry.kind), children: busy === entry.kind ? 'Generating…' : 'Generate and keep' }), _jsx("a", { className: "btn btn-sm", href: `/api/v1/reports/${orgId}/preview/${entry.kind}?format=html`, target: "_blank", rel: "noreferrer", children: "Preview" })] })] }, entry.kind))) })] }), _jsxs("section", { children: [_jsxs("div", { className: "tier-head", children: [_jsx("h2", { className: "tier-title", children: "Generated" }), _jsx("span", { className: "faint", style: { fontSize: 'var(--step--1)' }, children: "Kept exactly as issued. Newest first." })] }), stored.length === 0 ? (_jsx(Empty, { title: "Nothing generated yet.", children: _jsx("p", { className: "muted", children: "Generating keeps a copy, so the version you hand to someone stays the version they can come back to." }) })) : (_jsx("div", { className: "table-wrap", children: _jsxs("table", { className: "data", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Report" }), _jsx("th", { children: "Generated" }), _jsx("th", { children: "Download" })] }) }), _jsx("tbody", { children: stored.map((report) => (_jsxs("tr", { children: [_jsx("td", { children: _jsx("strong", { children: report.title }) }), _jsx("td", { className: "timeline-when", style: { whiteSpace: 'nowrap' }, children: new Date(report.createdAt).toLocaleString() }), _jsx("td", { children: _jsx("div", { className: "row", style: { gap: 'var(--s-2)' }, children: FORMATS.map((format) => (_jsx("a", { className: "btn btn-sm", href: `/api/v1/reports/${orgId}/${report.id}/download?format=${format.id}`, children: format.label }, format.id))) }) })] }, report.id))) })] }) }))] }), _jsxs("p", { className: "faint", style: { fontSize: 'var(--step--1)' }, children: [_jsx(Eyebrow, { children: "A note on PDFs" }), "PDFs are generated on the server, not printed from the browser, so the file you download is the same file every time regardless of who downloads it."] })] }));
}
