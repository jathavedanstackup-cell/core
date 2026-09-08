/**
 * Exercises and after-action review.
 *
 * An exercise is a rehearsal. C.O.R.E. computes what it expects to happen from
 * the organization model, participants record what actually happened, and the
 * review is the difference between the two.
 *
 * The expectation is captured when the exercise starts and never recomputed.
 * The model will change afterwards — often *because* of the exercise — and a
 * review that silently moved with it would not be a review.
 */

import type { ScenarioResult } from '@core/engine';

import type { ExerciseEventRow, ExerciseRow } from '../db/schema.js';

export interface ReviewImprovement {
  readonly title: string;
  readonly rationale: string;
  readonly expectedBenefit: string;
  readonly verification: string;
  readonly priority: 'P1' | 'P2' | 'P3';
}

export interface ExerciseReview {
  readonly summary: string;
  readonly whatWorked: readonly string[];
  readonly whatDidNot: readonly string[];
  readonly surprises: readonly string[];
  readonly missing: readonly string[];
  readonly timing: {
    readonly expectedMinutes: number | null;
    readonly actualMinutes: number | null;
    readonly deltaMinutes: number | null;
    readonly metTarget: boolean | null;
  };
  readonly recommendedImprovements: readonly ReviewImprovement[];
  readonly assumptions: readonly string[];
}

/**
 * The recovery target for an exercise: the tightest objective among the
 * business functions the scenario is expected to stop.
 *
 * The tightest rather than the average, because meeting the average while
 * missing the strictest one is not meeting the target.
 */
export function expectedRecoveryMinutes(
  expected: ScenarioResult | null,
  rtoByRef: ReadonlyMap<string, number | null>,
): number | null {
  if (expected === null) return null;
  let tightest: number | null = null;
  for (const fn of expected.failedFunctions) {
    const rto = rtoByRef.get(fn.entityId);
    if (rto == null) continue;
    if (tightest === null || rto < tightest) tightest = rto;
  }
  return tightest;
}

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}

/**
 * Build the review.
 *
 * Everything here is derived from the stored expectation and the recorded
 * events. Where the participants recorded nothing, the review says so rather
 * than inferring that all went well — an exercise nobody wrote anything down
 * during has not demonstrated anything.
 */
export function buildReview(
  exercise: ExerciseRow,
  events: readonly ExerciseEventRow[],
  entityNames: ReadonlyMap<string, string>,
): ExerciseReview {
  const expected = (exercise.expectedResult as ScenarioResult | null) ?? null;

  const byKind = (kind: string): ExerciseEventRow[] =>
    events.filter((event) => event.kind === kind);

  const gaps = byKind('gap');
  const decisions = byKind('decision');
  const actions = byKind('action');
  const recoveries = byKind('recovery');
  const observations = byKind('observation');

  // ---- timing -------------------------------------------------------------
  const expectedMinutes = exercise.expectedRecoveryMinutes;
  let actualMinutes = exercise.actualRecoveryMinutes;
  if (actualMinutes == null && exercise.startedAt !== null) {
    // Fall back only to a recorded recovery event. Deliberately NOT to the time
    // the exercise was closed: that measures how long someone left the form
    // open, and would credit an exercise where nobody recorded anything with a
    // recovery of nearly zero minutes — a fabricated success.
    const firstRecovery = recoveries[0]?.occurredAt;
    if (firstRecovery != null) {
      actualMinutes = minutesBetween(exercise.startedAt, firstRecovery);
    }
  }

  const deltaMinutes =
    expectedMinutes == null || actualMinutes == null ? null : actualMinutes - expectedMinutes;
  const metTarget = deltaMinutes === null ? null : deltaMinutes <= 0;

  // ---- what worked --------------------------------------------------------
  const whatWorked: string[] = [];
  for (const use of expected?.fallbacksUsed ?? []) {
    const dependent = entityNames.get(use.dependentId) ?? use.dependentId;
    const fallback = entityNames.get(use.fallbackProviderId) ?? use.fallbackProviderId;
    whatWorked.push(`${dependent} stayed available by falling back to ${fallback}.`);
  }
  if (decisions.length > 0) {
    whatWorked.push(`${decisions.length} decision(s) were recorded as they were taken.`);
  }
  if (metTarget === true && expectedMinutes != null) {
    whatWorked.push(
      `Recovery took ${actualMinutes} minutes against a ${expectedMinutes}-minute objective.`,
    );
  }

  // ---- what did not -------------------------------------------------------
  const whatDidNot: string[] = [];
  if (metTarget === false && expectedMinutes != null && actualMinutes != null) {
    whatDidNot.push(
      `Recovery took ${actualMinutes} minutes against a ${expectedMinutes}-minute objective, ${deltaMinutes} minute(s) over.`,
    );
  }
  for (const gap of gaps) whatDidNot.push(gap.description);

  // ---- surprises ----------------------------------------------------------
  // Anything observed that the model did not predict is the most valuable
  // output of an exercise, because it is a gap in the model itself.
  const predictedIds = new Set((expected?.impacted ?? []).map((item) => item.entityId));
  const surprises: string[] = [];
  for (const observation of observations) {
    for (const [ref, name] of entityNames) {
      if (predictedIds.has(ref)) continue;
      if (observation.description.toLowerCase().includes(name.toLowerCase())) {
        surprises.push(
          `"${name}" came up during the exercise but the model does not predict it is affected. The dependency may not be recorded.`,
        );
        break;
      }
    }
  }

  // ---- what was missing ---------------------------------------------------
  const missing: string[] = [];
  for (const gap of expected?.missingFallbacks ?? []) {
    const dependent = entityNames.get(gap.dependentId) ?? gap.dependentId;
    const provider = entityNames.get(gap.failedProviderId) ?? gap.failedProviderId;
    missing.push(`${dependent} had no alternative when ${provider} became unavailable.`);
  }
  if (events.length === 0) {
    missing.push(
      'Nothing was recorded during the exercise, so nothing about the response can be assessed.',
    );
  }
  if (actions.length === 0 && events.length > 0) {
    missing.push('No actions were recorded, so it is not clear what was actually done.');
  }

  // ---- improvements -------------------------------------------------------
  const recommendedImprovements: ReviewImprovement[] = [];

  for (const gap of (expected?.missingFallbacks ?? []).slice(0, 5)) {
    const dependent = entityNames.get(gap.dependentId) ?? gap.dependentId;
    const provider = entityNames.get(gap.failedProviderId) ?? gap.failedProviderId;
    recommendedImprovements.push({
      title: `Record an alternative for ${provider}, which ${dependent} depends on`,
      rationale: `During this exercise ${dependent} stopped because nothing was recorded that could take over from ${provider}.`,
      expectedBenefit: `${dependent} degrades rather than stops the next time ${provider} is unavailable.`,
      verification: `A failover to the alternative is exercised successfully.`,
      priority: 'P1',
    });
  }

  for (const gap of gaps.slice(0, 5)) {
    recommendedImprovements.push({
      title: `Close the gap: ${gap.description.slice(0, 120)}`,
      rationale: 'Recorded as a gap during the exercise.',
      expectedBenefit: 'The same gap does not appear in the next exercise or a real incident.',
      verification: 'The next exercise of this scenario records no equivalent gap.',
      priority: 'P2',
    });
  }

  if (metTarget === false && expectedMinutes != null) {
    recommendedImprovements.push({
      title: 'Shorten recovery, or agree that the objective is wrong',
      rationale: `Recovery took ${actualMinutes} minutes against a ${expectedMinutes}-minute objective. Either the process is too slow or the objective was never achievable.`,
      expectedBenefit: 'The recovery objective and the organization’s real capability agree.',
      verification: 'A subsequent exercise meets the objective, or the objective is formally revised.',
      priority: 'P1',
    });
  }

  // ---- assumptions --------------------------------------------------------
  const assumptions: string[] = [
    'The expectation was computed when the exercise started and reflects the organization model as it stood then.',
    'Only what participants recorded during the exercise is assessed here.',
  ];
  if (actualMinutes == null) {
    assumptions.push('No recovery time was recorded, so timing could not be assessed.');
  }

  const summary =
    metTarget === true
      ? `The organization recovered within its objective, with ${gaps.length} gap(s) recorded.`
      : metTarget === false
        ? `The organization did not recover within its objective, with ${gaps.length} gap(s) recorded.`
        : events.length === 0
          ? 'Nothing was recorded during this exercise, so it does not demonstrate anything about readiness.'
          : `The exercise recorded ${events.length} event(s) and ${gaps.length} gap(s). No recovery time was captured, so the objective could not be assessed.`;

  return {
    summary,
    whatWorked,
    whatDidNot,
    surprises: [...new Set(surprises)],
    missing,
    timing: { expectedMinutes, actualMinutes, deltaMinutes, metTarget },
    recommendedImprovements,
    assumptions,
  };
}
