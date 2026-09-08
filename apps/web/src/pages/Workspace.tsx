/**
 * The workspace.
 *
 * Answers four questions in order, top to bottom: what matters, what is at
 * risk, what needs attention, what to do. The single most important sentence
 * gets the most space; everything else is progressively disclosed underneath.
 *
 * There is no KPI wall. A row of large numbers would look authoritative and
 * say very little.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Band, Empty, ErrorState, Eyebrow, Loading } from '../components/Bits';
import { api, ApiError, type AssessmentResponse, type FindingSummary, type Tier } from '../lib/api';

const TIER_COPY: Record<Tier, { title: string; blurb: string }> = {
  FIX_FIRST: {
    title: 'Fix first',
    blurb: 'The highest value work available to you right now.',
  },
  FIX_NEXT: {
    title: 'Fix next',
    blurb: 'Worth doing, once the first list is moving.',
  },
  MONITOR: {
    title: 'Monitor',
    blurb: 'Recorded and watched. No action needed today.',
  },
};

export function WorkspacePage(): ReactNode {
  const { orgId } = useParams<{ orgId: string }>();
  const [data, setData] = useState<AssessmentResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (orgId === undefined) return;
    let cancelled = false;
    setData(null);
    setError(null);

    void api
      .get<AssessmentResponse>(`/api/v1/${orgId}/assessment`)
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught : null);
      });

    return () => {
      cancelled = true;
    };
  }, [orgId, reload]);

  if (error !== null) {
    return (
      <ErrorState
        title="Could not load the assessment"
        message={error.message}
        requestId={error.requestId}
        onRetry={() => setReload((n) => n + 1)}
      />
    );
  }

  if (data === null) return <Loading what="your organization" />;

  const first = data.tiers.FIX_FIRST[0];
  const errors = data.dataIssues.filter((issue) => issue.severity === 'error');
  const warnings = data.dataIssues.filter((issue) => issue.severity === 'warning');

  if (data.model.entityCount === 0) {
    return (
      <Empty title="Nothing recorded yet">
        <p className="muted">
          C.O.R.E. analyses what your organization has written down. Add the things you depend on —
          people, systems, suppliers, places — and how they connect, and the analysis follows.
        </p>
      </Empty>
    );
  }

  return (
    <div className="stack-lg">
      {/* --- what matters --------------------------------------------------- */}
      <section className="headline">
        <Eyebrow>What matters right now</Eyebrow>
        {first === undefined ? (
          <p className="headline-text" style={{ marginTop: 'var(--s-3)' }}>
            Nothing in this organization currently rates above moderate risk.
          </p>
        ) : (
          <>
            <p className="headline-text" style={{ marginTop: 'var(--s-3)' }}>
              {first.summary}
            </p>
            <p className="headline-sub">{first.rationale}</p>
            <p style={{ marginTop: 'var(--s-4)' }}>
              <Link className="btn btn-primary" to={`finding/${encodeURIComponent(first.id)}`}>
                See the options
              </Link>
            </p>
          </>
        )}
      </section>

      {/* --- what is at risk ------------------------------------------------ */}
      <section>
        <Eyebrow>What is at risk</Eyebrow>
        <div className="counts" style={{ marginTop: 'var(--s-3)' }}>
          <Count value={data.summary.critical} label="Critical" tone="CRITICAL" />
          <Count value={data.summary.high} label="High" tone="HIGH" />
          <Count value={data.summary.moderate} label="Moderate" tone="MODERATE" />
          <Count value={data.summary.low} label="Low" tone="LOW" />
          <Count value={data.model.entityCount} label="Things recorded" />
          <Count value={data.model.dependencyCount} label="Dependencies" />
        </div>
      </section>

      {/* --- data quality --------------------------------------------------- */}
      {(errors.length > 0 || warnings.length > 0) && (
        <section className={errors.length > 0 ? 'notice notice-error' : 'notice notice-warn'}>
          <strong>
            {errors.length > 0
              ? `${errors.length} problem(s) in your organization data`
              : `${warnings.length} thing(s) worth checking`}
          </strong>
          <ul style={{ marginTop: 'var(--s-2)', paddingLeft: '1.1rem' }}>
            {[...errors, ...warnings].slice(0, 5).map((issue) => (
              <li key={issue.code + issue.subjectId}>{issue.message}</li>
            ))}
          </ul>
        </section>
      )}

      {/* --- what to do ----------------------------------------------------- */}
      {(['FIX_FIRST', 'FIX_NEXT', 'MONITOR'] as const).map((tier) => {
        const items = data.tiers[tier];
        if (items.length === 0) return null;
        return (
          <section key={tier} className="tier">
            <div className="tier-head">
              <h2 className="tier-title">{TIER_COPY[tier].title}</h2>
              <span className="faint" style={{ fontSize: 'var(--step--1)' }}>
                {TIER_COPY[tier].blurb}
              </span>
            </div>
            <ul className="finding-list">
              {items.map((finding) => (
                <li key={finding.id}>
                  <FindingRow finding={finding} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <p className="faint" style={{ fontSize: 'var(--step--1)' }}>
        Assessed {new Date(data.generatedAt).toLocaleString()} from {data.model.entityCount} recorded
        items. Only recorded dependencies are considered.
      </p>
    </div>
  );
}

function FindingRow({ finding }: { finding: FindingSummary }): ReactNode {
  return (
    <Link className="finding" to={`finding/${encodeURIComponent(finding.id)}`}>
      <div className="finding-top">
        <Band value={finding.risk.band} />
        <span className="finding-subject">{finding.subjectName}</span>
        <span className="finding-kind">{finding.subjectKind.replace(/_/g, ' ')}</span>
        {finding.criticalDependents > 0 && (
          <span className="tag">
            {finding.criticalDependents} critical function
            {finding.criticalDependents === 1 ? '' : 's'} affected
          </span>
        )}
      </div>
      <p className="finding-summary">{finding.summary}</p>
      <p className="finding-rationale">{finding.rationale}</p>
    </Link>
  );
}

function Count({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
}): ReactNode {
  return (
    <div className="count">
      <div
        className="count-value"
        style={tone === undefined ? undefined : { color: `var(--band-${tone.toLowerCase()})` }}
      >
        {value}
      </div>
      <div className="count-label">{label}</div>
    </div>
  );
}
