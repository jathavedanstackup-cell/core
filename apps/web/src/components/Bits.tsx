/**
 * Small shared pieces.
 *
 * Status is never communicated by colour alone: every band carries its label,
 * and the badge shape differs per band, so the interface still works in
 * greyscale and for anyone who cannot distinguish the hues.
 */

import type { ReactNode } from 'react';

import type { Reason, RiskBand } from '../lib/api';

export function Band({ value }: { value: string }): ReactNode {
  const label = value.replace(/_/g, ' ');
  return <span className={`band band-${value}`}>{label}</span>;
}

export function Eyebrow({ children }: { children: ReactNode }): ReactNode {
  return <p className="eyebrow">{children}</p>;
}

export function Loading({ what }: { what: string }): ReactNode {
  return (
    <div className="state-block" role="status">
      <span className="spinner" aria-hidden="true" />
      <p className="muted">Loading {what}…</p>
    </div>
  );
}

export function ErrorState({
  title,
  message,
  requestId,
  onRetry,
}: {
  title: string;
  message: string;
  requestId?: string | undefined;
  onRetry?: () => void;
}): ReactNode {
  return (
    <div className="state-block notice-error" role="alert">
      <h3>{title}</h3>
      <p>{message}</p>
      {requestId !== undefined && (
        <p className="faint" style={{ fontSize: 'var(--step--1)' }}>
          Reference <code>{requestId}</code>
        </p>
      )}
      {onRetry !== undefined && (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }): ReactNode {
  return (
    <div className="state-block">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

/**
 * The reasons behind a risk band.
 *
 * This is the component that makes the product's central claim true: a band is
 * never shown without the ability to see exactly why it was reached.
 */
export function RiskReasons({
  reasons,
  score,
  maxScore,
  band,
  overrideRule,
}: {
  reasons: Reason[];
  score: number;
  maxScore: number;
  band: RiskBand;
  overrideRule?: string | undefined;
}): ReactNode {
  return (
    <div className="reasons">
      <div className="row-between">
        <Eyebrow>Why this is {band.toLowerCase()}</Eyebrow>
        <span className="faint" style={{ fontSize: 'var(--step--1)' }}>
          {score} of {maxScore} points
        </span>
      </div>
      <ul className="reason-list">
        {reasons.map((reason) => (
          <li key={reason.code + reason.statement.slice(0, 24)}>
            <span
              className={`reason-points ${reason.contribution > 0 ? 'up' : reason.contribution < 0 ? 'down' : 'flat'}`}
            >
              {reason.contribution > 0 ? `+${reason.contribution}` : reason.contribution}
            </span>
            <span className="reason-body">
              <span>{reason.statement}</span>
              <ConfidenceTag value={reason.confidence} />
            </span>
          </li>
        ))}
      </ul>
      {overrideRule !== undefined && (
        <p className="reason-override">
          <strong>Rule applied:</strong> {overrideRule}
        </p>
      )}
    </div>
  );
}

/**
 * How much the system actually knows about a statement.
 *
 * Shown next to every reason because presenting an assumption as a fact is the
 * failure mode this product most needs to avoid.
 */
export function ConfidenceTag({ value }: { value: Reason['confidence'] }): ReactNode {
  const explanation: Record<Reason['confidence'], string> = {
    KNOWN: 'Recorded in your organization data.',
    ESTIMATED: 'Derived from what depends on this, not stated directly.',
    ASSUMED: 'Assumed in the absence of a recorded answer.',
    UNKNOWN: 'Nobody has recorded an answer to this.',
    UNVERIFIED: 'Recorded, but out of date and not re-confirmed.',
  };
  return (
    <span className={`confidence confidence-${value}`} title={explanation[value]}>
      {value.toLowerCase()}
    </span>
  );
}

export function TradeOffBar({
  label,
  value,
}: {
  label: string;
  value: 'LOW' | 'MEDIUM' | 'HIGH';
}): ReactNode {
  const steps = { LOW: 1, MEDIUM: 2, HIGH: 3 }[value];
  return (
    <div className="tradeoff">
      <span className="tradeoff-label">{label}</span>
      <span className="tradeoff-pips" aria-label={`${label}: ${value.toLowerCase()}`}>
        {[1, 2, 3].map((pip) => (
          <span key={pip} className={pip <= steps ? 'pip on' : 'pip'} />
        ))}
      </span>
      <span className="tradeoff-value">{value.toLowerCase()}</span>
    </div>
  );
}
