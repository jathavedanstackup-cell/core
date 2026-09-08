import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Routing.
 *
 * The introduction is a gate on the root path only, and only for a browser
 * that has not seen it. Everything else is either public authentication or an
 * organization workspace, and the workspace routes refuse to render until the
 * session is known — so a signed-out visitor never sees a flash of the product.
 */
import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Loading } from './components/Bits';
import { CinematicIntro } from './intro/CinematicIntro';
import { ActionsPage } from './pages/Actions';
import { AuditPage } from './pages/Audit';
import { ExercisesPage } from './pages/Exercises';
import { FindingPage } from './pages/Finding';
import { ImprovementsPage } from './pages/Improvements';
import { IncidentsPage } from './pages/Incidents';
import { ReadinessPage } from './pages/Readiness';
import { ReportsPage } from './pages/Reports';
import { ScenariosPage } from './pages/Scenarios';
import { SetupPage } from './pages/Setup';
import { WelcomePage } from './pages/Welcome';
import { WorkspacePage } from './pages/Workspace';
import { hasSeenIntro, markIntroSeen, useSession } from './state/session';
function IntroGate() {
    const navigate = useNavigate();
    const { status, me } = useSession();
    const [showIntro, setShowIntro] = useState(() => !hasSeenIntro());
    const destination = useCallback(() => {
        if (status !== 'signed-in' || me === null)
            return '/welcome';
        const first = me.organizations[0];
        return first === undefined ? '/setup' : `/o/${first.id}`;
    }, [status, me]);
    const finish = useCallback(() => {
        markIntroSeen();
        setShowIntro(false);
    }, []);
    useEffect(() => {
        if (showIntro)
            return;
        if (status === 'loading')
            return;
        navigate(destination(), { replace: true });
    }, [showIntro, status, destination, navigate]);
    if (showIntro)
        return _jsx(CinematicIntro, { onFinish: finish });
    return _jsx(Loading, { what: "C.O.R.E." });
}
/** Requires a signed-in, verified session; otherwise sends the visitor to sign in. */
function Protected({ children }) {
    const { status, me } = useSession();
    if (status === 'loading')
        return _jsx(Loading, { what: "your session" });
    if (status === 'signed-out' || me === null)
        return _jsx(Navigate, { to: "/welcome", replace: true });
    if (!me.user.emailVerified)
        return _jsx(Navigate, { to: "/welcome?step=verify", replace: true });
    return _jsx(_Fragment, { children: children });
}
export function App() {
    return (_jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(IntroGate, {}) }), _jsx(Route, { path: "/welcome", element: _jsx(WelcomePage, {}) }), _jsx(Route, { path: "/setup", element: _jsx(Protected, { children: _jsx(SetupPage, {}) }) }), _jsxs(Route, { path: "/o/:orgId", element: _jsx(Protected, { children: _jsx(AppShell, {}) }), children: [_jsx(Route, { index: true, element: _jsx(WorkspacePage, {}) }), _jsx(Route, { path: "finding/:findingId", element: _jsx(FindingPage, {}) }), _jsx(Route, { path: "scenarios", element: _jsx(ScenariosPage, {}) }), _jsx(Route, { path: "actions", element: _jsx(ActionsPage, {}) }), _jsx(Route, { path: "readiness", element: _jsx(ReadinessPage, {}) }), _jsx(Route, { path: "exercises", element: _jsx(ExercisesPage, {}) }), _jsx(Route, { path: "incidents", element: _jsx(IncidentsPage, {}) }), _jsx(Route, { path: "improvements", element: _jsx(ImprovementsPage, {}) }), _jsx(Route, { path: "reports", element: _jsx(ReportsPage, {}) }), _jsx(Route, { path: "audit", element: _jsx(AuditPage, {}) })] }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] }));
}
