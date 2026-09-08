/**
 * The improvement register.
 *
 * Kept separate from actions on purpose. An action closes a weakness now; an
 * improvement reduces the chance of it recurring. Mixing them makes the action
 * list — which should be short and current — fill with long-horizon work.
 */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { Empty, ErrorState, Loading } from '../components/Bits';
import { api, ApiError } from '../lib/api';

interface Improvement {
  id: string;
  title: string;
  rationale: string | null;
  expectedBenefit: string | null;
  verification: string | null;
  priority: 'P1' | 'P2' | 'P3';
  status: Status;
  ownerHint: string | null;
  sourceExerciseId: string | null;
  completedAt: string | null;
  createdAt: string;
}

type Status = 'PROPOSED' | 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'DECLINED';

/** Mirrors the server's state machine, so no impossible move is offered. */
const NEXT: Record<Status, Status[]> = {
  PROPOSED: ['ACCEPTED', 'DECLINED'],
  ACCEPTED: ['IN_PROGRESS', 'DECLINED'],
  IN_PROGRESS: ['COMPLETED', 'ACCEPTED', 'DECLINED'],
  COMPLETED: [],
  DECLINED: ['PROPOSED'],
};

const TONE: Record<Status, string> = {
  PROPOSED: 'NEUTRAL',
  ACCEPTED: 'MODERATE',
  IN_PROGRESS: 'HIGH',
  COMPLETED: 'LOW',
  DECLINED: 'NEUTRAL',
};

export function ImprovementsPage(): ReactNode {
  const { orgId } = useParams<{ orgId: string }>();
  const [items, setItems] = useState<Improvement[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [title, setTitle] = useState('');
  const [benefit, setBenefit] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (orgId === undefined) return;
    try {
      const response = await api.get<{ improvements: Improvement[] }>(
        `/api/v1/improvements/${orgId}`,
      );
      setItems(response.improvements);
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

  if (error !== null && items === null) {
    return (
      <ErrorState title="Could not load improvements" message={error.message} requestId={error.requestId} />
    );
  }
  if (items === null) return <Loading what="the improvement register" />;

  const open = items.filter((item) => item.status !== 'COMPLETED' && item.status !== 'DECLINED');

  return (
    <div className="stack-lg">
      <header className="page-head">
        <h1 style={{ fontSize: 'var(--step-3)' }}>Improvements</h1>
        <p className="lede">
          Preventive work: making a failure less likely next time, rather than closing a weakness
          now. {open.length} open of {items.length} recorded.
        </p>
      </header>

      {error !== null && (
        <div className="notice notice-error" role="alert">
          {error.message}
        </div>
      )}

      <form
        className="card row"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void act(async () => {
            await api.post(`/api/v1/improvements/${orgId}`, {
              title: title.trim(),
              ...(benefit.trim() === '' ? {} : { expectedBenefit: benefit.trim() }),
            });
            setTitle('');
            setBenefit('');
          });
        }}
      >
        <input
          className="plain-input"
          style={{ flex: '2 1 18rem' }}
          placeholder="What should change?"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <input
          className="plain-input"
          style={{ flex: '2 1 16rem' }}
          placeholder="Expected benefit"
          value={benefit}
          onChange={(event) => setBenefit(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || title.trim() === ''}>
          Add
        </button>
      </form>

      {items.length === 0 ? (
        <Empty title="Nothing recorded yet.">
          <p className="muted">
            Completing an exercise proposes improvements from what it found; accept them from the
            exercise page to bring them here.
          </p>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Priority</th>
                <th>Improvement</th>
                <th>Status</th>
                <th>Move to</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="priority">{item.priority}</span>
                  </td>
                  <td style={{ minWidth: '20rem' }}>
                    <strong>{item.title}</strong>
                    {item.expectedBenefit !== null && (
                      <span className="verify-note" style={{ display: 'block' }}>
                        Benefit: {item.expectedBenefit}
                      </span>
                    )}
                    {item.verification !== null && (
                      <span className="verify-note" style={{ display: 'block' }}>
                        Verified by: {item.verification}
                      </span>
                    )}
                    {item.sourceExerciseId !== null && (
                      <span className="tag" style={{ marginTop: 'var(--s-2)', display: 'inline-block' }}>
                        from an exercise
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`band band-${TONE[item.status]}`}>
                      {item.status.replace(/_/g, ' ')}
                    </span>
                    {item.completedAt !== null && (
                      <span className="verify-note" style={{ display: 'block' }}>
                        {new Date(item.completedAt).toLocaleDateString()}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 'var(--s-2)' }}>
                      {NEXT[item.status].length === 0 ? (
                        <span className="faint">—</span>
                      ) : (
                        NEXT[item.status].map((status) => (
                          <button
                            key={status}
                            type="button"
                            className="btn btn-sm"
                            disabled={busy}
                            onClick={() =>
                              void act(() =>
                                api.patch(`/api/v1/improvements/${orgId}/${item.id}`, { status }),
                              )
                            }
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
      )}
    </div>
  );
}
