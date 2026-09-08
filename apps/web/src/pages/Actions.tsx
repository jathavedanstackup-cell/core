/**
 * Actions.
 *
 * These are persisted records, not checkboxes in the browser. Only the
 * transitions the server permits are offered, so the interface cannot suggest
 * something the API will refuse, and a completed action always shows when it
 * completed.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { Empty, ErrorState, Loading } from '../components/Bits';
import { api, ApiError, type ActionRecord } from '../lib/api';

type Status = ActionRecord['status'];

/** Mirrors the server's state machine so no impossible move is offered. */
const NEXT: Record<Status, Status[]> = {
  READY: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED'],
  BLOCKED: ['READY', 'IN_PROGRESS', 'CANCELLED'],
  COMPLETED: [],
  FAILED: ['READY', 'IN_PROGRESS', 'CANCELLED'],
  CANCELLED: ['READY'],
};

const STATUS_TONE: Record<Status, string> = {
  READY: 'NEUTRAL',
  IN_PROGRESS: 'MODERATE',
  BLOCKED: 'HIGH',
  COMPLETED: 'LOW',
  FAILED: 'CRITICAL',
  CANCELLED: 'NEUTRAL',
};

export function ActionsPage(): ReactNode {
  const { orgId } = useParams<{ orgId: string }>();
  const [actions, setActions] = useState<ActionRecord[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (orgId === undefined) return;
    try {
      const response = await api.get<{ actions: ActionRecord[] }>(`/api/v1/actions/${orgId}`);
      setActions(response.actions);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : null);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const move = useCallback(
    async (action: ActionRecord, status: Status) => {
      if (orgId === undefined) return;
      setPending(action.id);
      setError(null);
      try {
        await api.patch(`/api/v1/actions/${orgId}/${action.id}`, { status });
        await load();
      } catch (caught) {
        setError(caught instanceof ApiError ? caught : null);
      } finally {
        setPending(null);
      }
    },
    [orgId, load],
  );

  if (error !== null && actions === null) {
    return <ErrorState title="Could not load actions" message={error.message} requestId={error.requestId} />;
  }
  if (actions === null) return <Loading what="actions" />;

  const open = actions.filter((a) => a.status !== 'COMPLETED' && a.status !== 'CANCELLED');
  const closed = actions.filter((a) => a.status === 'COMPLETED' || a.status === 'CANCELLED');

  return (
    <div className="stack-lg">
      <header className="page-head">
        <h1 style={{ fontSize: 'var(--step-3)' }}>Actions</h1>
        <p className="lede">
          {open.length === 0
            ? 'Nothing is currently open.'
            : `${open.length} open, ${closed.length} finished.`}{' '}
          Actions created from a solution carry the step that verifies them.
        </p>
      </header>

      {error !== null && (
        <div className="notice notice-error" role="alert">
          {error.message}
        </div>
      )}

      {actions.length === 0 ? (
        <Empty title="No actions yet">
          <p className="muted">
            Open a finding from the workspace and create an action plan from one of its options.
          </p>
        </Empty>
      ) : (
        <>
          <ActionTable
            title="Open"
            rows={open}
            pending={pending}
            onMove={(action, status) => void move(action, status)}
          />
          {closed.length > 0 && (
            <ActionTable
              title="Finished"
              rows={closed}
              pending={pending}
              onMove={(action, status) => void move(action, status)}
            />
          )}
        </>
      )}
    </div>
  );
}

function ActionTable({
  title,
  rows,
  pending,
  onMove,
}: {
  title: string;
  rows: ActionRecord[];
  pending: string | null;
  onMove: (action: ActionRecord, status: Status) => void;
}): ReactNode {
  if (rows.length === 0) return null;
  return (
    <section>
      <div className="tier-head">
        <h2 className="tier-title">{title}</h2>
        <span className="faint" style={{ fontSize: 'var(--step--1)' }}>
          {rows.length} action{rows.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Action</th>
              <th>Owner</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Move to</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((action) => (
              <tr key={action.id}>
                <td style={{ minWidth: '18rem' }}>
                  <strong>{action.title}</strong>
                  {action.verification !== null && (
                    <span className="verify-note" style={{ display: 'block' }}>
                      Done when: {action.verification}
                    </span>
                  )}
                  {action.completedAt !== null && (
                    <span className="verify-note" style={{ display: 'block' }}>
                      Completed {new Date(action.completedAt).toLocaleString()}
                    </span>
                  )}
                </td>
                <td>{action.ownerHint ?? '—'}</td>
                <td>
                  <span className="priority">{action.priority}</span>
                </td>
                <td>
                  <span className={`band band-${STATUS_TONE[action.status]}`}>
                    {action.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td>
                  <div className="row" style={{ gap: 'var(--s-2)' }}>
                    {NEXT[action.status].length === 0 ? (
                      <span className="faint">—</span>
                    ) : (
                      NEXT[action.status].map((status) => (
                        <button
                          key={status}
                          type="button"
                          className="btn btn-sm"
                          disabled={pending === action.id}
                          onClick={() => onMove(action, status)}
                        >
                          {status.replace(/_/g, ' ').toLowerCase()}
                        </button>
                      ))
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
