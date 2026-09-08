/**
 * Audit trail.
 *
 * Read-only, newest first. There is no edit and no delete anywhere in the
 * product, because a record that can be rewritten is not a record.
 *
 * Reading it needs the LEADER role, so a viewer landing here is told that
 * plainly rather than shown an empty page.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { Empty, ErrorState, Loading } from '../components/Bits';
import { api, ApiError } from '../lib/api';

interface AuditEvent {
  id: string;
  actor: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export function AuditPage(): ReactNode {
  const { orgId } = useParams<{ orgId: string }>();
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (orgId === undefined) return;
    let cancelled = false;
    void api
      .get<{ events: AuditEvent[] }>(`/api/v1/audit/${orgId}`)
      .then((response) => {
        if (!cancelled) setEvents(response.events);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught : null);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (error !== null) {
    return (
      <ErrorState
        title={error.status === 403 ? 'Not available to your role' : 'Could not load the audit trail'}
        message={error.message}
        requestId={error.requestId}
      />
    );
  }
  if (events === null) return <Loading what="the audit trail" />;

  return (
    <div className="stack-lg">
      <header className="page-head">
        <h1 style={{ fontSize: 'var(--step-3)' }}>Audit trail</h1>
        <p className="lede">
          Who changed what, and when. Append-only: nothing in C.O.R.E. can edit or remove an entry.
        </p>
      </header>

      {events.length === 0 ? (
        <Empty title="Nothing recorded yet." />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td className="timeline-when" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(event.createdAt).toLocaleString()}
                  </td>
                  <td>{event.actor ?? 'system'}</td>
                  <td>
                    <strong>{event.action.replace(/_/g, ' ')}</strong>
                    <span className="verify-note" style={{ display: 'block' }}>
                      {event.entityType}
                      {event.entityId !== null ? ` · ${event.entityId}` : ''}
                    </span>
                  </td>
                  <td style={{ maxWidth: '26rem' }}>
                    <ChangeSummary before={event.before} after={event.after} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Renders the recorded before/after without pretending to more precision. */
function ChangeSummary({ before, after }: { before: unknown; after: unknown }): ReactNode {
  const describe = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'object') return String(value);
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== null && item !== undefined)
      .slice(0, 4)
      .map(([key, item]) => `${key}: ${typeof item === 'object' ? '…' : String(item)}`);
    return entries.length === 0 ? null : entries.join(', ');
  };

  const from = describe(before);
  const to = describe(after);

  if (from === null && to === null) return <span className="faint">—</span>;
  return (
    <span style={{ fontSize: 'var(--step--1)' }}>
      {from !== null && (
        <span className="faint" style={{ display: 'block' }}>
          was — {from}
        </span>
      )}
      {to !== null && <span style={{ display: 'block' }}>now — {to}</span>}
    </span>
  );
}
