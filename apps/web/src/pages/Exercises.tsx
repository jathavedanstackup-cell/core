/**
 * Exercises.
 *
 * The page follows the real sequence: plan, start, record while it runs,
 * complete. Starting is what freezes the engine's expectation, and the
 * interface says so, because a rehearsal scored against a model that moved
 * afterwards would prove nothing.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { Empty, ErrorState, Eyebrow, Loading } from '../components/Bits';
import { api, ApiError, type EntitySummary } from '../lib/api';

interface Exercise {
  id: string;
  reference: string;
  title: string;
  objective: string | null;
  scenarioRefs: string[];
  status: 'PLANNED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED';
  startedAt: string | null;
  endedAt: string | null;
  expectedRecoveryMinutes: number | null;
  actualRecoveryMinutes: number | null;
  hasReview: boolean;
}

interface Review {
  summary: string;
  whatWorked: string[];
  whatDidNot: string[];
  surprises: string[];
  missing: string[];
  timing: {
    expectedMinutes: number | null;
    actualMinutes: number | null;
    deltaMinutes: number | null;
    metTarget: boolean | null;
  };
  recommendedImprovements: {
    title: string;
    rationale: string;
    expectedBenefit: string;
    priority: string;
  }[];
  assumptions: string[];
}

interface TimelineEvent {
  id: string;
  kind: string;
  description: string;
  occurredAt: string;
}

const EVENT_KINDS = ['decision', 'action', 'observation', 'gap', 'recovery', 'note'] as const;

export function ExercisesPage(): ReactNode {
  const { orgId } = useParams<{ orgId: string }>();
  const [list, setList] = useState<Exercise[] | null>(null);
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ review: Review | null; timeline: TimelineEvent[] } | null>(
    null,
  );

  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [eventKind, setEventKind] = useState<(typeof EVENT_KINDS)[number]>('observation');
  const [eventText, setEventText] = useState('');
  const [actualMinutes, setActualMinutes] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (orgId === undefined) return;
    try {
      const [exerciseResponse, entityResponse] = await Promise.all([
        api.get<{ exercises: Exercise[] }>(`/api/v1/exercises/${orgId}`),
        api.get<{ entities: EntitySummary[] }>(`/api/v1/model/${orgId}/entities`),
      ]);
      setList(exerciseResponse.exercises);
      setEntities(entityResponse.entities);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : null);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = useCallback(
    async (id: string) => {
      if (orgId === undefined) return;
      if (openId === id) {
        setOpenId(null);
        return;
      }
      const response = await api.get<{ review: Review | null; timeline: TimelineEvent[] }>(
        `/api/v1/exercises/${orgId}/${id}`,
      );
      setDetail(response);
      setOpenId(id);
    },
    [orgId, openId],
  );

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

  if (error !== null && list === null) {
    return <ErrorState title="Could not load exercises" message={error.message} requestId={error.requestId} />;
  }
  if (list === null) return <Loading what="exercises" />;

  const nameOf = (ref: string): string =>
    entities.find((entity) => entity.ref === ref)?.name ?? ref;

  return (
    <div className="stack-lg">
      <header className="page-head">
        <h1 style={{ fontSize: 'var(--step-3)' }}>Exercises</h1>
        <p className="lede">
          Rehearse a failure. C.O.R.E. records what it expects to happen when the exercise starts,
          you record what actually happens, and the review is the difference between the two.
        </p>
      </header>

      {error !== null && (
        <div className="notice notice-error" role="alert">
          {error.message}
        </div>
      )}

      {/* ---- plan a new exercise ---------------------------------------- */}
      <section className="card stack">
        <Eyebrow>Plan an exercise</Eyebrow>
        <input
          className="plain-input"
          placeholder="What are you rehearsing?"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <div>
          <p className="faint" style={{ fontSize: 'var(--step--1)', marginBottom: 'var(--s-2)' }}>
            What becomes unavailable?
          </p>
          <div className="row">
            {entities
              .filter((entity) => entity.kind !== 'business_function')
              .slice(0, 24)
              .map((entity) => {
                const on = picked.includes(entity.ref);
                return (
                  <button
                    key={entity.ref}
                    type="button"
                    className={on ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
                    aria-pressed={on}
                    onClick={() =>
                      setPicked((previous) =>
                        previous.includes(entity.ref)
                          ? previous.filter((ref) => ref !== entity.ref)
                          : [...previous, entity.ref],
                      )
                    }
                  >
                    {entity.name}
                  </button>
                );
              })}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || title.trim() === '' || picked.length === 0}
          onClick={() =>
            void act(async () => {
              await api.post(`/api/v1/exercises/${orgId}`, {
                title: title.trim(),
                scenarioRefs: picked,
              });
              setTitle('');
              setPicked([]);
            })
          }
        >
          Plan exercise
        </button>
      </section>

      {list.length === 0 ? (
        <Empty title="No exercises yet.">
          <p className="muted">A plan nobody has rehearsed is an assumption, not a capability.</p>
        </Empty>
      ) : (
        <ul className="finding-list">
          {list.map((exercise) => (
            <li key={exercise.id}>
              <div className="finding" style={{ cursor: 'default' }}>
                <div className="finding-top">
                  <span className={`band band-${statusTone(exercise.status)}`}>
                    {exercise.status}
                  </span>
                  <span className="finding-subject">{exercise.title}</span>
                  <span className="finding-kind">{exercise.reference}</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    style={{ marginLeft: 'auto' }}
                    aria-expanded={openId === exercise.id}
                    onClick={() => void openDetail(exercise.id)}
                  >
                    {openId === exercise.id ? 'Hide' : 'Open'}
                  </button>
                </div>

                <p className="finding-summary">
                  Scenario: {exercise.scenarioRefs.map(nameOf).join(', ')}
                </p>

                {exercise.expectedRecoveryMinutes !== null && (
                  <p className="finding-rationale">
                    Objective {exercise.expectedRecoveryMinutes} min
                    {exercise.actualRecoveryMinutes !== null &&
                      ` · actual ${exercise.actualRecoveryMinutes} min`}
                  </p>
                )}

                <div className="row" style={{ marginTop: 'var(--s-3)' }}>
                  {exercise.status === 'PLANNED' && (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={busy}
                      onClick={() =>
                        void act(() => api.post(`/api/v1/exercises/${orgId}/${exercise.id}/start`))
                      }
                    >
                      Start — this freezes the expectation
                    </button>
                  )}
                  {exercise.status === 'RUNNING' && (
                    <>
                      <input
                        className="plain-input"
                        style={{ flex: '1 1 16rem' }}
                        placeholder="Record what just happened"
                        value={eventText}
                        onChange={(event) => setEventText(event.target.value)}
                      />
                      <select
                        className="plain-input"
                        style={{ width: 'auto' }}
                        value={eventKind}
                        onChange={(event) =>
                          setEventKind(event.target.value as (typeof EVENT_KINDS)[number])
                        }
                      >
                        {EVENT_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {kind}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy || eventText.trim() === ''}
                        onClick={() =>
                          void act(async () => {
                            await api.post(`/api/v1/exercises/${orgId}/${exercise.id}/events`, {
                              kind: eventKind,
                              description: eventText.trim(),
                            });
                            setEventText('');
                            if (openId === exercise.id) await openDetail(exercise.id);
                          })
                        }
                      >
                        Record
                      </button>
                      <input
                        className="plain-input"
                        style={{ width: '9rem' }}
                        inputMode="numeric"
                        placeholder="recovery min"
                        value={actualMinutes}
                        onChange={(event) =>
                          setActualMinutes(event.target.value.replace(/\D/g, ''))
                        }
                      />
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={busy}
                        onClick={() =>
                          void act(() =>
                            api.post(`/api/v1/exercises/${orgId}/${exercise.id}/complete`, {
                              ...(actualMinutes === ''
                                ? {}
                                : { actualRecoveryMinutes: Number(actualMinutes) }),
                            }),
                          )
                        }
                      >
                        Complete and review
                      </button>
                    </>
                  )}
                  {exercise.status === 'COMPLETED' && exercise.hasReview && (
                    <>
                      <a
                        className="btn btn-sm"
                        href={`/api/v1/reports/${orgId}/preview/exercise?format=pdf&subject=${exercise.id}&download=true`}
                      >
                        Download review (PDF)
                      </a>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() =>
                          void act(() =>
                            api.post(`/api/v1/exercises/${orgId}/${exercise.id}/improvements`),
                          )
                        }
                      >
                        Accept improvements into the register
                      </button>
                    </>
                  )}
                </div>

                {openId === exercise.id && detail !== null && (
                  <ExerciseDetail detail={detail} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function statusTone(status: Exercise['status']): string {
  switch (status) {
    case 'RUNNING':
      return 'HIGH';
    case 'COMPLETED':
      return 'LOW';
    case 'CANCELLED':
      return 'NEUTRAL';
    default:
      return 'MODERATE';
  }
}

function ExerciseDetail({
  detail,
}: {
  detail: { review: Review | null; timeline: TimelineEvent[] };
}): ReactNode {
  const { review, timeline } = detail;
  return (
    <div style={{ marginTop: 'var(--s-5)' }} className="stack">
      {review !== null && (
        <div className="reasons">
          <Eyebrow>After-action review</Eyebrow>
          <p style={{ marginTop: 'var(--s-2)' }}>{review.summary}</p>

          <div className="counts" style={{ marginTop: 'var(--s-4)' }}>
            <div className="count">
              <div className="count-value">{review.timing.expectedMinutes ?? '—'}</div>
              <div className="count-label">Objective (min)</div>
            </div>
            <div className="count">
              <div
                className="count-value"
                style={{
                  color:
                    review.timing.metTarget === false
                      ? 'var(--band-critical)'
                      : review.timing.metTarget === true
                        ? 'var(--band-low)'
                        : undefined,
                }}
              >
                {review.timing.actualMinutes ?? '—'}
              </div>
              <div className="count-label">Actual (min)</div>
            </div>
            <div className="count">
              <div className="count-value">
                {review.timing.metTarget === null
                  ? '—'
                  : review.timing.metTarget
                    ? 'Met'
                    : 'Missed'}
              </div>
              <div className="count-label">Objective</div>
            </div>
          </div>

          {(
            [
              ['What worked', review.whatWorked],
              ['What did not', review.whatDidNot],
              ['What surprised us', review.surprises],
              ['What was missing', review.missing],
            ] as const
          ).map(([heading, items]) =>
            items.length === 0 ? null : (
              <div key={heading} style={{ marginTop: 'var(--s-4)' }}>
                <Eyebrow>{heading}</Eyebrow>
                <ul style={{ marginTop: 'var(--s-2)', paddingLeft: '1.1rem' }} className="muted">
                  {items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ),
          )}

          {review.recommendedImprovements.length > 0 && (
            <div style={{ marginTop: 'var(--s-4)' }}>
              <Eyebrow>Recommended improvements</Eyebrow>
              <ol className="action-steps">
                {review.recommendedImprovements.map((item) => (
                  <li key={item.title} className="action-step">
                    <span className="priority">{item.priority}</span>
                    <span>
                      <span>{item.title}</span>
                      <span className="verify-note">{item.expectedBenefit}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {timeline.length > 0 && (
        <div>
          <Eyebrow>What happened — oldest first</Eyebrow>
          <ul className="timeline" style={{ marginTop: 'var(--s-2)' }}>
            {timeline.map((event) => (
              <li key={event.id}>
                <span className="timeline-when">
                  {new Date(event.occurredAt).toLocaleString()}
                </span>
                <span>
                  <span className="timeline-kind">{event.kind}</span>
                  <span style={{ display: 'block' }}>{event.description}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
