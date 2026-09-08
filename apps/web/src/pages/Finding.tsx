/**
 * One weakness, in full: the problem, why it matters, why it scored as it did,
 * the options, and the plan.
 *
 * The recommended option is marked but never the only one shown, and its
 * rationale is stated so a reader can disagree with the reasoning rather than
 * just the answer.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Band, ErrorState, Eyebrow, Loading, RiskReasons, TradeOffBar } from '../components/Bits';
import { api, ApiError, type SolutionOption, type SolutionsResponse } from '../lib/api';

export function FindingPage(): ReactNode {
  const { orgId, findingId } = useParams<{ orgId: string; findingId: string }>();
  const [data, setData] = useState<SolutionsResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [planned, setPlanned] = useState<{ count: number; option: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (orgId === undefined || findingId === undefined) return;
    let cancelled = false;
    setData(null);
    setError(null);

    void api
      .get<SolutionsResponse>(
        `/api/v1/${orgId}/solutions?finding=${encodeURIComponent(findingId)}`,
      )
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught : null);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId, findingId]);

  const createPlan = useCallback(
    async (optionId: string) => {
      if (orgId === undefined || findingId === undefined || busy) return;
      setBusy(true);
      try {
        const result = await api.post<{ option: { title: string }; actions: unknown[] }>(
          `/api/v1/actions/${orgId}/from-solution`,
          { findingId, optionId },
        );
        setPlanned({ count: result.actions.length, option: result.option.title });
      } catch (caught) {
        setError(caught instanceof ApiError ? caught : null);
      } finally {
        setBusy(false);
      }
    },
    [orgId, findingId, busy],
  );

  if (error !== null) {
    return (
      <ErrorState title="Could not load this finding" message={error.message} requestId={error.requestId} />
    );
  }
  if (data === null) return <Loading what="this finding" />;

  const { finding, solutions } = data;
  const recommended = solutions.options.find((o) => o.id === solutions.recommendedOptionId);

  return (
    <div className="stack-lg">
      <p>
        <Link to=".." relative="path" className="btn btn-quiet btn-sm">
          ← Back to workspace
        </Link>
      </p>

      <header className="page-head" style={{ maxWidth: '52rem' }}>
        <div className="row">
          <Band value={finding.risk.band} />
          <span className="faint">{finding.subjectKind.replace(/_/g, ' ')}</span>
        </div>
        <h1 style={{ fontSize: 'var(--step-3)' }}>{finding.subjectName}</h1>
        <p className="lede">{solutions.problem}</p>
        <p className="muted">{solutions.whyItMatters}</p>
      </header>

      <RiskReasons
        reasons={finding.risk.reasons}
        score={finding.risk.score}
        maxScore={finding.risk.maxScore}
        band={finding.risk.band}
        overrideRule={finding.risk.overrideRule}
      />

      <section>
        <div className="tier-head">
          <h2 className="tier-title">What you can do</h2>
          <span className="faint" style={{ fontSize: 'var(--step--1)' }}>
            {solutions.options.length} option{solutions.options.length === 1 ? '' : 's'}, most
            effective first
          </span>
        </div>

        <div className="stack">
          {solutions.options.map((option) => (
            <OptionCard
              key={option.id}
              option={option}
              recommended={option.id === solutions.recommendedOptionId}
              rationale={
                option.id === solutions.recommendedOptionId
                  ? solutions.recommendationRationale
                  : undefined
              }
              onPlan={() => void createPlan(option.id)}
              busy={busy}
            />
          ))}
        </div>
      </section>

      {planned !== null && (
        <div className="notice" style={{ borderColor: 'var(--accent-line)', background: 'var(--accent-soft)' }}>
          <strong>{planned.count} action(s) created</strong> for “{planned.option}”.{' '}
          <Link to="../actions" relative="path">
            Track them on the actions page
          </Link>
          .
        </div>
      )}

      {recommended !== undefined && (
        <p className="faint" style={{ fontSize: 'var(--step--1)', maxWidth: 'var(--reading-width)' }}>
          These options are generated from what your organization has recorded. They are a starting
          point for a decision, not the decision itself.
        </p>
      )}
    </div>
  );
}

function OptionCard({
  option,
  recommended,
  rationale,
  onPlan,
  busy,
}: {
  option: SolutionOption;
  recommended: boolean;
  rationale?: string | undefined;
  onPlan: () => void;
  busy: boolean;
}): ReactNode {
  const [open, setOpen] = useState(recommended);

  return (
    <article className={recommended ? 'option recommended' : 'option'}>
      <div className="option-head">
        <h3 className="option-title">{option.title}</h3>
        {recommended && <span className="recommend-flag">Recommended</span>}
      </div>

      <p className="muted" style={{ marginTop: 'var(--s-3)', maxWidth: '52rem' }}>
        {option.description}
      </p>

      {rationale !== undefined && (
        <p style={{ marginTop: 'var(--s-3)', fontSize: 'var(--step--1)' }}>
          <strong>Why this one:</strong> {rationale}
        </p>
      )}

      <div className="tradeoffs">
        <TradeOffBar label="Cost" value={option.tradeOffs.cost} />
        <TradeOffBar label="Effort" value={option.tradeOffs.effort} />
        <TradeOffBar label="Time" value={option.tradeOffs.time} />
        <TradeOffBar label="Disruption" value={option.tradeOffs.disruption} />
        <div className="tradeoff">
          <span className="tradeoff-label">Removes</span>
          <span className="tradeoff-pips" aria-label={`Removes ${option.riskReduction} of 3`}>
            {[1, 2, 3].map((pip) => (
              <span key={pip} className={pip <= option.riskReduction ? 'pip on' : 'pip'} />
            ))}
          </span>
          <span className="tradeoff-value">{option.riskReduction} of 3</span>
        </div>
      </div>

      <div className="row" style={{ marginTop: 'var(--s-4)' }}>
        <button type="button" className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide the plan' : 'Show the plan'}
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={onPlan} disabled={busy}>
          {busy ? 'Creating…' : 'Create action plan'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 'var(--s-4)' }}>
          {option.preconditions.length > 0 && (
            <>
              <Eyebrow>This assumes</Eyebrow>
              <ul style={{ margin: 'var(--s-2) 0 var(--s-4)', paddingLeft: '1.1rem' }} className="muted">
                {option.preconditions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}

          <Eyebrow>Steps</Eyebrow>
          <ol className="action-steps">
            {option.actions.map((action) => (
              <li key={action.title} className="action-step">
                <span className="priority">{action.priority}</span>
                <span>
                  <span>{action.title}</span>
                  <span className="verify-note">
                    Owner: {action.ownerHint} · Done when: {action.verification}
                  </span>
                </span>
              </li>
            ))}
          </ol>

          <p className="verify-note" style={{ marginTop: 'var(--s-4)' }}>
            <strong>The weakness is gone when:</strong> {option.verification}
          </p>
        </div>
      )}
    </article>
  );
}
