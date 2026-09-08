/**
 * Readiness.
 *
 * Whether the organization is actually prepared, check by check. The important
 * distinction on this page is between a check that failed and a check nobody
 * has answered — they are different problems and they get different marks.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { Band, Empty, ErrorState, Loading } from '../components/Bits';
import { api, ApiError, type ReadinessAssessment, type ReadinessState } from '../lib/api';

interface Response {
  counts: Record<ReadinessState, number>;
  assessments: ReadinessAssessment[];
}

export function ReadinessPage(): ReactNode {
  const { orgId } = useParams<{ orgId: string }>();
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (orgId === undefined) return;
    let cancelled = false;
    void api
      .get<Response>(`/api/v1/${orgId}/readiness`)
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught : null);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (error !== null) {
    return <ErrorState title="Could not load readiness" message={error.message} requestId={error.requestId} />;
  }
  if (data === null) return <Loading what="readiness" />;
  if (data.assessments.length === 0) return <Empty title="Nothing recorded to assess yet." />;

  return (
    <div className="stack-lg">
      <header className="page-head">
        <h1 style={{ fontSize: 'var(--step-3)' }}>Readiness</h1>
        <p className="lede">
          Not whether a plan exists, but whether it would work. A check with no recorded answer
          counts as unknown, never as a pass.
        </p>
      </header>

      <div className="counts">
        <div className="count">
          <div className="count-value" style={{ color: 'var(--band-critical)' }}>
            {data.counts.CRITICAL}
          </div>
          <div className="count-label">Critical</div>
        </div>
        <div className="count">
          <div className="count-value" style={{ color: 'var(--band-high)' }}>
            {data.counts.AT_RISK}
          </div>
          <div className="count-label">At risk</div>
        </div>
        <div className="count">
          <div className="count-value" style={{ color: 'var(--band-moderate)' }}>
            {data.counts.PARTIAL}
          </div>
          <div className="count-label">Partial</div>
        </div>
        <div className="count">
          <div className="count-value" style={{ color: 'var(--band-low)' }}>
            {data.counts.READY}
          </div>
          <div className="count-label">Ready</div>
        </div>
      </div>

      <ul className="finding-list">
        {data.assessments.map((item) => {
          const isOpen = open === item.subjectId;
          return (
            <li key={item.subjectId}>
              <div className="finding" style={{ cursor: 'default' }}>
                <div className="finding-top">
                  <Band value={item.state} />
                  <span className="finding-subject">{item.subjectName}</span>
                  <span className="finding-kind">{item.subjectKind.replace(/_/g, ' ')}</span>
                  <span className="finding-kind">
                    {item.passedCount} of {item.applicableCount} checks pass
                    {item.unknownCount > 0 ? `, ${item.unknownCount} unknown` : ''}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    style={{ marginLeft: 'auto' }}
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : item.subjectId)}
                  >
                    {isOpen ? 'Hide checks' : 'Show checks'}
                  </button>
                </div>
                <p className="finding-summary">{item.summary}</p>

                {isOpen && (
                  <ul className="checks" style={{ marginTop: 'var(--s-4)' }}>
                    {item.checks.map((check) => (
                      <li key={check.code} className="check">
                        <span
                          className={
                            check.passed
                              ? 'check-mark check-pass'
                              : check.unknown
                                ? 'check-mark check-unknown'
                                : 'check-mark check-fail'
                          }
                          aria-hidden="true"
                        >
                          {check.passed ? '✓' : check.unknown ? '?' : '✕'}
                        </span>
                        <span>
                          <strong>{check.label}</strong>
                          <span className="verify-note" style={{ display: 'block' }}>
                            {check.detail}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
