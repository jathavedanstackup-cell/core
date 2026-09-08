import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The signed-in frame: identity, organization, navigation.
 *
 * Navigation stays short on purpose. The product has a lot of surface, but a
 * person arriving at it should see the few things they might act on, not an
 * inventory of every feature.
 */
import { useEffect, useMemo } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { useSession } from '../state/session';
import './shell.css';
// Ordered by the loop the product describes: understand, respond, recover,
// improve. Audit sits last because it is a record, not a place to work.
const NAV = [
    { to: '', label: 'Workspace', end: true },
    { to: 'readiness', label: 'Readiness' },
    { to: 'scenarios', label: 'Scenarios' },
    { to: 'actions', label: 'Actions' },
    { to: 'incidents', label: 'Incidents' },
    { to: 'exercises', label: 'Exercises' },
    { to: 'improvements', label: 'Improvements' },
    { to: 'reports', label: 'Reports' },
    { to: 'audit', label: 'Audit' },
];
export function AppShell() {
    const { orgId } = useParams();
    const { me, signOut } = useSession();
    const navigate = useNavigate();
    const org = useMemo(() => me?.organizations.find((candidate) => candidate.id === orgId), [me, orgId]);
    // Landing on an organization the session does not belong to should send the
    // visitor somewhere real rather than rendering an empty frame.
    useEffect(() => {
        if (me === null)
            return;
        if (org !== undefined)
            return;
        const first = me.organizations[0];
        navigate(first === undefined ? '/setup' : `/o/${first.id}`, { replace: true });
    }, [me, org, navigate]);
    if (org === undefined)
        return null;
    return (_jsxs("div", { className: "shell", children: [_jsx("a", { className: "skip-link", href: "#main", children: "Skip to content" }), _jsxs("header", { className: "topbar", children: [_jsxs("div", { className: "container topbar-inner", children: [_jsxs("div", { className: "topbar-identity", children: [_jsx("span", { className: "mark", children: "C.O.R.E." }), _jsx("span", { className: "mark-divider", "aria-hidden": "true" }), _jsx("span", { className: "org-name", children: org.name }), org.isDemo && _jsx("span", { className: "tag demo-tag", children: "Demo" })] }), _jsxs("div", { className: "topbar-actions", children: [me !== null && me.organizations.length > 1 && (_jsxs("label", { className: "org-switch", children: [_jsx("span", { className: "visually-hidden", children: "Organization" }), _jsx("select", { value: org.id, onChange: (event) => navigate(`/o/${event.target.value}`), children: me.organizations.map((candidate) => (_jsx("option", { value: candidate.id, children: candidate.name }, candidate.id))) })] })), _jsx("span", { className: "role-tag", title: "Your role in this organization", children: org.role.toLowerCase() }), _jsx("button", { type: "button", className: "btn btn-quiet btn-sm", onClick: () => {
                                            void signOut().then(() => navigate('/welcome', { replace: true }));
                                        }, children: "Sign out" })] })] }), _jsx("nav", { className: "mainnav", "aria-label": "Sections", children: _jsx("div", { className: "container mainnav-inner", children: NAV.map((item) => (_jsx(NavLink, { to: item.to, end: item.end ?? false, className: ({ isActive }) => (isActive ? 'navlink active' : 'navlink'), children: item.label }, item.label))) }) })] }), _jsx("main", { id: "main", className: "container main-area", children: _jsx(Outlet, {}) }), _jsx("footer", { className: "footer", children: _jsxs("div", { className: "container footer-inner", children: [_jsx("span", { className: "faint", children: "C.O.R.E. \u2014 Continuity, Operations, Risk & Execution" }), org.isDemo && (_jsx("span", { className: "faint", children: "Demo organization. The data is invented; the analysis is not." }))] }) })] }));
}
