/**
 * Routing.
 *
 * The introduction is a gate on the root path only, and only for a browser
 * that has not seen it. Everything else is either public authentication or an
 * organization workspace, and the workspace routes refuse to render until the
 * session is known — so a signed-out visitor never sees a flash of the product.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
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

function IntroGate(): ReactNode {
  const navigate = useNavigate();
  const { status, me } = useSession();
  const [showIntro, setShowIntro] = useState(() => !hasSeenIntro());

  const destination = useCallback(() => {
    if (status !== 'signed-in' || me === null) return '/welcome';
    const first = me.organizations[0];
    return first === undefined ? '/setup' : `/o/${first.id}`;
  }, [status, me]);

  const finish = useCallback(() => {
    markIntroSeen();
    setShowIntro(false);
  }, []);

  useEffect(() => {
    if (showIntro) return;
    if (status === 'loading') return;
    navigate(destination(), { replace: true });
  }, [showIntro, status, destination, navigate]);

  if (showIntro) return <CinematicIntro onFinish={finish} />;
  return <Loading what="C.O.R.E." />;
}

/** Requires a signed-in, verified session; otherwise sends the visitor to sign in. */
function Protected({ children }: { children: ReactNode }): ReactNode {
  const { status, me } = useSession();

  if (status === 'loading') return <Loading what="your session" />;
  if (status === 'signed-out' || me === null) return <Navigate to="/welcome" replace />;
  if (!me.user.emailVerified) return <Navigate to="/welcome?step=verify" replace />;
  return <>{children}</>;
}

export function App(): ReactNode {
  return (
    <Routes>
      <Route path="/" element={<IntroGate />} />
      <Route path="/welcome" element={<WelcomePage />} />
      <Route
        path="/setup"
        element={
          <Protected>
            <SetupPage />
          </Protected>
        }
      />
      <Route
        path="/o/:orgId"
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route index element={<WorkspacePage />} />
        <Route path="finding/:findingId" element={<FindingPage />} />
        <Route path="scenarios" element={<ScenariosPage />} />
        <Route path="actions" element={<ActionsPage />} />
        <Route path="readiness" element={<ReadinessPage />} />
        <Route path="exercises" element={<ExercisesPage />} />
        <Route path="incidents" element={<IncidentsPage />} />
        <Route path="improvements" element={<ImprovementsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="audit" element={<AuditPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
