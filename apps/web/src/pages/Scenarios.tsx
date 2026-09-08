/**
 * "What happens if…?"
 *
 * Pick what becomes unavailable, and see what stops, in the order it stops.
 * Waves are the point: knowing that the database goes first and payroll goes
 * four steps later is what tells a responder where the front line is.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { Empty, ErrorState, Eyebrow, Loading } from '../components/Bits';
import { api, ApiError, type EntitySummary, type ScenarioResult } from '../lib/api';

interface RunResponse {
  run: { id: string; description: string; createdAt: string };
  result: ScenarioResult;
}

interface HistoryResponse {
  runs: { id: string; description: string; failedRefs: string[]; createdAt: string }[];
}

export function ScenariosPage(): ReactNode {
  const { orgId } = useParams<{ orgId: string }>();
  const [entities, setEntities] = useState<EntitySummary[] | null>(null);
  const [history, setHistory] = useState<HistoryResponse['runs']>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [current, setCurrent] = useState<RunResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (orgId === undefined) return;
    let cancelled = false;

    void Promise.all([
      api.get<{ entities: EntitySummary[] }>(`/api/v1/model/${orgId}/entities`),
      api.get<HistoryResponse>(`/api/v1/${orgId}/scenarios`),
    ])
      .then(([entityResponse, historyResponse]) => {
        if (cancelled) return;
        setEntities(entityResponse.entities);
        setHistory(historyResponse.runs);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught : null);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const run = useCallback(async () => {
    if (orgId === undefined || selected.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<RunResponse>(`/api/v1/${orgId}/scenarios`, {
        failedRefs: selected,
      });
      setCurrent(response);
      const refreshed = await api.get<HistoryResponse>(`/api/v1/${orgId}/scenarios`);
      setHistory(refreshed.runs);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : null);
    } finally {
      setBusy(false);
    }
  }, [orgId, selected, busy]);

  const openRun = useCallback(
    async (runId: string) => {
      if (orgId === undefined) return;
      const response = await api.get<RunResponse>(`/api/v1/${orgId}/scenarios/${runId}`);
      setCurrent(response);
      setSelected([]);
    },
    [orgId],
  );

  if (error !== null && entities === null) {
    return <ErrorState title="Could not load" message={error.message} requestId={error.requestId} />;
  }
  if (entities === null) return <Loading what="your organization" />;

  const grouped = new Map<string, EntitySummary[]>();
  for (const entity of entities) {
    const list = grouped.get(entity.kind) ?? [];
    list.push(entity);
    grouped.set(entity.kind, list);
  }

  return (
    <div className="stack-lg">
      <header className="page-head">
        <h1 style={{ fontSize: 'var(--step-3)' }}>What happens if…?</h1>
        <p className="lede">
          Choose what becomes unavailable. C.O.R.E. follows your recorded dependencies and reports
          what stops, in the order it stops.
        </p>
      </header>

      <section className="card">
        <Eyebrow>Choose what fails</Eyebrow>
        <div style={{ marginTop: 'var(--s-3)', display: 'grid', gap: 'var(--s-4)' }}>
          {[...grouped.entries()].map(([kind, items]) => (
            <div key={kind}>
              <p className="faint" style={{ fontSize: 'var(--step--1)', marginBottom: 'var(--s-2)' }}>
                {kind.replace(/_/g, ' ')}
              </p>
              <div className="row">
                {items.map((entity) => {
                  const on = selected.includes(entity.ref);
                  return (
                    <button
                      key={entity.ref}
                      type="button"
                      className={on ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
                      aria-pressed={on}
                      onClick={() =>
                        setSelected((previous) =>
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
          ))}
        </div>

        <div className="row" style={{ marginTop: 'var(--s-5)' }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={selected.length === 0 || busy}
            onClick={() => void run()}
          >
            {busy ? 'Running…' : `Run scenario${selected.length > 0 ? ` (${selected.length})` : ''}`}
          </button>
          {selected.length > 0 && (
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setSelected([])}>
              Clear
            </button>
          )}
        </div>

        {error !== null && (
          <p className="error" role="alert" style={{ marginTop: 'var(--s-3)', color: 'var(--band-critical)' }}>
            {error.message}
          </p>
        )}
      </section>

      {current !== null && <ScenarioOutcome run={current} />}

      {history.length > 0 && (
        <section>
          <div className="tier-head">
            <h2 className="tier-title">Previous runs</h2>
            <span className="faint" style={{ fontSize: 'var(--step--1)' }}>
              Newest first. Each keeps the result it produced at the time.
            </span>
          </div>
          <ul className="finding-list">
            {history.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="finding"
                  style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
                  onClick={() => void openRun(item.id)}
                >
                  <p className="finding-summary">{item.description}</p>
                  <p className="finding-rationale">
                    {new Date(item.createdAt).toLocaleString()}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ScenarioOutcome({ run }: { run: RunResponse }): ReactNode {
  const { result } = run;
  const failedCount = result.impacted.filter((item) => item.state === 'FAILED').length;
  const degradedCount = result.impacted.filter((item) => item.state === 'DEGRADED').length;

  if (result.impacted.length === 0) {
    return <Empty title="Nothing recorded is affected by that." />;
  }

  return (
    <section className="stack">
      <div className="headline">
        <Eyebrow>What happens</Eyebrow>
        <p className="headline-text" style={{ marginTop: 'var(--s-3)' }}>
          {result.failedFunctions.length === 0
            ? `${failedCount} recorded item${failedCount === 1 ? '' : 's'} stop, but no business function fails outright.`
            : `${result.failedFunctions.map((f) => f.name).join(', ')} stop${result.failedFunctions.length === 1 ? 's' : ''}.`}
        </p>
        <p className="headline-sub">
          {failedCount} item{failedCount === 1 ? '' : 's'} stop, {degradedCount} continue in a
          reduced state, across {result.waves.length - 1} step
          {result.waves.length - 1 === 1 ? '' : 's'} of knock-on effect.
        </p>
      </div>

      <div className="waves">
        {result.waves.map((wave, index) => (
          <div key={index} className="wave">
            <div className="wave-head">
              <span>{index === 0 ? 'What you removed' : `Breaks ${index === 1 ? 'first' : `step ${index}`}`}</span>
              <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0 }}>
                {wave.length} item{wave.length === 1 ? '' : 's'}
              </span>
            </div>
            <ul className="wave-list">
              {wave.map((item) => (
                <li key={item.entityId} className="wave-item">
                  <span className={`impact-state impact-${item.state}`}>{item.state}</span>
                  <span>
                    <strong>{item.name}</strong>
                    <span className="verify-note" style={{ display: 'block' }}>
                      {item.explanation}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {result.fallbacksUsed.length > 0 && (
        <div className="notice">
          <strong>{result.fallbacksUsed.length} fallback(s) held.</strong> Those parts of the
          organization kept working because an alternative was recorded.
        </div>
      )}

      {result.missingFallbacks.length > 0 && (
        <div className="notice notice-warn">
          <strong>{result.missingFallbacks.length} place(s) had no alternative.</strong> Each is a
          point where the failure spread because nothing was recorded to take over.
        </div>
      )}

      <div className="notice">
        <Eyebrow>Assumptions</Eyebrow>
        <ul style={{ marginTop: 'var(--s-2)', paddingLeft: '1.1rem' }}>
          {result.assumptions.map((assumption) => (
            <li key={assumption}>{assumption}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
