/**
 * People and their roles in this organization.
 *
 * Roles are enforced server-side; this page is only how they get set. Adding
 * somebody requires them to have a verified C.O.R.E. account already — there is
 * no email-invitation flow, and the page says so rather than leaving an admin
 * wondering why nothing arrived.
 */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { ErrorState, Eyebrow, Loading } from '../components/Bits';
import { api, ApiError, type Role } from '../lib/api';
import { useSession } from '../state/session';

interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
}

const ROLES: { id: Role; label: string; can: string }[] = [
  { id: 'ADMIN', label: 'Admin', can: 'Everything, including managing people and roles.' },
  { id: 'LEADER', label: 'Leader', can: 'Everything an operator can do, plus the audit trail.' },
  {
    id: 'OPERATOR',
    label: 'Operator',
    can: 'Change the model, run scenarios and exercises, move actions.',
  },
  { id: 'VIEWER', label: 'Viewer', can: 'Read the assessment. Change nothing.' },
];

export function PeoplePage(): ReactNode {
  const { orgId } = useParams<{ orgId: string }>();
  const { me } = useSession();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('VIEWER');
  const [busy, setBusy] = useState(false);

  const myRole = me?.organizations.find((org) => org.id === orgId)?.role;
  const isAdmin = myRole === 'ADMIN';

  const load = useCallback(async () => {
    if (orgId === undefined) return;
    try {
      const response = await api.get<{ members: Member[] }>(
        `/api/v1/organizations/${orgId}/members`,
      );
      setMembers(response.members);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : null);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (work: () => Promise<unknown>) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await work();
        await load();
      } catch (caught) {
        setError(caught instanceof ApiError ? caught : null);
      } finally {
        setBusy(false);
      }
    },
    [busy, load],
  );

  if (error !== null && members === null) {
    return <ErrorState title="Could not load people" message={error.message} requestId={error.requestId} />;
  }
  if (members === null) return <Loading what="people" />;

  return (
    <div className="stack-lg">
      <header className="page-head">
        <h1 style={{ fontSize: 'var(--step-3)' }}>People</h1>
        <p className="lede">
          Who can see and change this organization. Roles are enforced by the server on every
          request, not by hiding buttons.
        </p>
      </header>

      {error !== null && (
        <div className="notice notice-error" role="alert">
          {error.message}
        </div>
      )}

      {isAdmin && (
        <form
          className="card stack"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void act(async () => {
              await api.post(`/api/v1/organizations/${orgId}/members`, {
                email: email.trim(),
                role,
              });
              setEmail('');
            });
          }}
        >
          <Eyebrow>Add someone</Eyebrow>
          <div className="row">
            <input
              className="plain-input"
              style={{ flex: '2 1 18rem' }}
              type="email"
              placeholder="their email address"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <select
              className="plain-input"
              style={{ width: 'auto' }}
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
            >
              {ROLES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-primary" disabled={busy || email.trim() === ''}>
              Add
            </button>
          </div>
          <p className="faint" style={{ fontSize: 'var(--step--1)' }}>
            They need a C.O.R.E. account already. There is no email invitation yet, so ask them to
            sign up first and then add the address here.
          </p>
        </form>
      )}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Joined</th>
              {isAdmin && <th />}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const isMe = member.userId === me?.user.id;
              return (
                <tr key={member.userId}>
                  <td>
                    <strong>{member.name}</strong>
                    {isMe && <span className="tag" style={{ marginLeft: 'var(--s-2)' }}>you</span>}
                  </td>
                  <td>{member.email}</td>
                  <td>
                    {isAdmin ? (
                      <select
                        className="plain-input"
                        style={{ width: 'auto' }}
                        value={member.role}
                        disabled={busy}
                        onChange={(event) =>
                          void act(() =>
                            api.patch(
                              `/api/v1/organizations/${orgId}/members/${member.userId}`,
                              { role: event.target.value },
                            ),
                          )
                        }
                      >
                        {ROLES.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="role-tag">{member.role.toLowerCase()}</span>
                    )}
                  </td>
                  <td className="timeline-when">
                    {new Date(member.joinedAt).toLocaleDateString()}
                  </td>
                  {isAdmin && (
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm btn-quiet"
                        disabled={busy}
                        onClick={() =>
                          void act(() =>
                            api.del(
                              `/api/v1/organizations/${orgId}/members/${member.userId}`,
                            ),
                          )
                        }
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="card">
        <Eyebrow>What each role can do</Eyebrow>
        <ul style={{ marginTop: 'var(--s-3)', paddingLeft: '1.1rem' }} className="muted">
          {ROLES.map((option) => (
            <li key={option.id} style={{ marginBottom: 'var(--s-2)' }}>
              <strong>{option.label}</strong> — {option.can}
            </li>
          ))}
        </ul>
        <p className="faint" style={{ fontSize: 'var(--step--1)', marginTop: 'var(--s-3)' }}>
          The last administrator cannot be removed or demoted, so an organization cannot lock itself
          out of its own administration.
        </p>
      </section>
    </div>
  );
}
