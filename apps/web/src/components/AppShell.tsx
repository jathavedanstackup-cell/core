/**
 * The signed-in frame: identity, organization, navigation.
 *
 * Navigation stays short on purpose. The product has a lot of surface, but a
 * person arriving at it should see the few things they might act on, not an
 * inventory of every feature.
 */

import { useEffect, useMemo, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';

import { useSession } from '../state/session';
import './shell.css';

const NAV = [
  { to: '', label: 'Workspace', end: true },
  { to: 'readiness', label: 'Readiness' },
  { to: 'scenarios', label: 'Scenarios' },
  { to: 'actions', label: 'Actions' },
  { to: 'incidents', label: 'Incidents' },
  { to: 'audit', label: 'Audit' },
];

export function AppShell(): ReactNode {
  const { orgId } = useParams<{ orgId: string }>();
  const { me, signOut } = useSession();
  const navigate = useNavigate();

  const org = useMemo(
    () => me?.organizations.find((candidate) => candidate.id === orgId),
    [me, orgId],
  );

  // Landing on an organization the session does not belong to should send the
  // visitor somewhere real rather than rendering an empty frame.
  useEffect(() => {
    if (me === null) return;
    if (org !== undefined) return;
    const first = me.organizations[0];
    navigate(first === undefined ? '/setup' : `/o/${first.id}`, { replace: true });
  }, [me, org, navigate]);

  if (org === undefined) return null;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="topbar">
        <div className="container topbar-inner">
          <div className="topbar-identity">
            <span className="mark">C.O.R.E.</span>
            <span className="mark-divider" aria-hidden="true" />
            <span className="org-name">{org.name}</span>
            {org.isDemo && <span className="tag demo-tag">Demo</span>}
          </div>

          <div className="topbar-actions">
            {me !== null && me.organizations.length > 1 && (
              <label className="org-switch">
                <span className="visually-hidden">Organization</span>
                <select
                  value={org.id}
                  onChange={(event) => navigate(`/o/${event.target.value}`)}
                >
                  {me.organizations.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className="role-tag" title="Your role in this organization">
              {org.role.toLowerCase()}
            </span>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => {
                void signOut().then(() => navigate('/welcome', { replace: true }));
              }}
            >
              Sign out
            </button>
          </div>
        </div>

        <nav className="mainnav" aria-label="Sections">
          <div className="container mainnav-inner">
            {NAV.map((item) => (
              <NavLink
                key={item.label}
                to={item.to}
                end={item.end ?? false}
                className={({ isActive }) => (isActive ? 'navlink active' : 'navlink')}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      <main id="main" className="container main-area">
        <Outlet />
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <span className="faint">
            C.O.R.E. — Continuity, Operations, Risk &amp; Execution
          </span>
          {org.isDemo && (
            <span className="faint">
              Demo organization. The data is invented; the analysis is not.
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}
