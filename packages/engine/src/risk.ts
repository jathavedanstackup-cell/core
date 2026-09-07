/**
 * Explainable risk scoring.
 *
 * Deliberate design choices, both required by the product spec:
 *
 * 1. No percentages. A percentage implies a calibrated probability model built
 *    on incident frequency data that this system does not have. Presenting one
 *    would be a fabricated fact. We produce an ordinal band instead.
 *
 * 2. Every point of score is attributable. The band is a pure function of the
 *    reasons, and each reason names the real entities it is talking about, so a
 *    reviewer can always ask "why is this CRITICAL?" and get a real answer.
 *
 * The dimensions and their weights are constants in this file rather than
 * scattered magic numbers, so the scoring rule can be reviewed as a unit.
 */

import { effectiveCriticality, transitiveDependents, type GraphIndex } from './graph.js';
import {
  CRITICALITY_RANK,
  RISK_BAND_RANK,
  type Confidence,
  type Criticality,
  type Entity,
  type FindingKind,
  type Reason,
  type RiskAssessment,
  type RiskBand,
} from './types.js';

/** Maximum points each dimension can contribute. Sums to MAX_SCORE. */
const WEIGHTS = Object.freeze({
  impact: 4,
  concentration: 2,
  recoverability: 3,
  currency: 2,
  sharpness: 1,
});

export const MAX_SCORE =
  WEIGHTS.impact +
  WEIGHTS.concentration +
  WEIGHTS.recoverability +
  WEIGHTS.currency +
  WEIGHTS.sharpness;

/** Score at or above which each band applies, checked highest first. */
const BAND_THRESHOLDS: readonly (readonly [RiskBand, number])[] = Object.freeze([
  ['CRITICAL', 9],
  ['HIGH', 6],
  ['MODERATE', 3],
  ['LOW', 0],
]);

/** A recovery capability older than this is treated as unproven. */
export const TEST_FRESHNESS_DAYS = 365;

/** Contact and access details older than this are treated as stale. */
export const CURRENCY_FRESHNESS_DAYS = 180;

/**
 * Finding kinds that concentrate risk in something hard to substitute quickly.
 * A missing person or credential typically bites faster than a missing
 * document, so those carry one extra point.
 */
const SHARP_FINDING_KINDS: ReadonlySet<FindingKind> = new Set<FindingKind>([
  'single_person',
  'single_credential',
  'single_recovery_path',
]);

export interface EntityRiskInput {
  readonly index: GraphIndex;
  readonly subject: Entity;
  readonly findingKind: FindingKind;
  /** Instant the assessment is made against, passed in so results reproduce. */
  readonly now: Date;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

function parseInstant(value: string | null | undefined): Date | null {
  if (value == null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function bandForScore(score: number): RiskBand {
  for (const [band, threshold] of BAND_THRESHOLDS) {
    if (score >= threshold) return band;
  }
  return 'LOW';
}

/**
 * Score one weakness about one entity.
 *
 * Returns the band together with the reasons that produced it. Callers must
 * surface the reasons; a band shown on its own is exactly the unexplained risk
 * score the product forbids.
 */
export function assessEntityRisk(input: EntityRiskInput): RiskAssessment {
  const { index, subject, findingKind, now } = input;
  const reasons: Reason[] = [];

  const dependentIds = transitiveDependents(index, subject.id);
  const dependentFunctions: Entity[] = [];
  for (const id of dependentIds) {
    const entity = index.entityById.get(id);
    if (entity?.kind === 'business_function') dependentFunctions.push(entity);
  }

  // ---- Impact -------------------------------------------------------------
  let highestCriticality: Criticality = 'LOW';
  let peakFunction: Entity | null = null;
  for (const fn of dependentFunctions) {
    const criticality = fn.criticality ?? 'LOW';
    if (peakFunction === null || CRITICALITY_RANK[criticality] > CRITICALITY_RANK[highestCriticality]) {
      highestCriticality = criticality;
      peakFunction = fn;
    }
  }

  let impactPoints: number;
  let impactConfidence: Confidence = 'KNOWN';
  if (peakFunction === null) {
    if (dependentIds.length === 0) {
      impactPoints = 0;
      reasons.push({
        code: 'impact.none',
        dimension: 'impact',
        statement: `Nothing recorded depends on "${subject.name}", so a failure here has no traced business consequence.`,
        contribution: 0,
        confidence: 'KNOWN',
      });
    } else {
      impactPoints = 1;
      impactConfidence = 'UNKNOWN';
      reasons.push({
        code: 'impact.untraced',
        dimension: 'impact',
        statement: `${dependentIds.length} item(s) depend on "${subject.name}", but none of them is linked to a business function, so the business consequence cannot be traced.`,
        contribution: 1,
        confidence: 'UNKNOWN',
      });
    }
  } else {
    impactPoints = Math.min(WEIGHTS.impact, CRITICALITY_RANK[highestCriticality] + 1);
    const inherited = subject.criticality === undefined;
    impactConfidence = inherited ? 'ESTIMATED' : 'KNOWN';
    reasons.push({
      code: 'impact.function',
      dimension: 'impact',
      statement:
        `Losing "${subject.name}" stops "${peakFunction.name}", which is a ${highestCriticality} business function` +
        (dependentFunctions.length > 1
          ? ` (${dependentFunctions.length} business functions depend on it in total).`
          : '.') +
        (inherited
          ? ` "${subject.name}" has no criticality of its own, so it inherits ${highestCriticality} from what depends on it.`
          : ''),
      contribution: impactPoints,
      confidence: impactConfidence,
    });
  }

  // ---- Concentration ------------------------------------------------------
  let concentrationPoints = 0;
  if (dependentIds.length >= 5) {
    concentrationPoints = 2;
  } else if (dependentIds.length >= 2) {
    concentrationPoints = 1;
  }
  if (concentrationPoints > 0) {
    reasons.push({
      code: 'concentration.dependents',
      dimension: 'concentration',
      statement: `${dependentIds.length} recorded item(s) depend on "${subject.name}", so the consequences of losing it are concentrated rather than isolated.`,
      contribution: concentrationPoints,
      confidence: 'KNOWN',
    });
  }

  // ---- Recoverability -----------------------------------------------------
  // Start from "we cannot recover this" and earn the points back.
  // Annotated as number: WEIGHTS is frozen, so its properties carry literal
  // types and the counter would otherwise be pinned to its starting value.
  let recoverabilityPoints: number = WEIGHTS.recoverability;
  const alternates = (subject.alternateIds ?? []).filter((id) => index.entityById.has(id));
  if (alternates.length > 0) {
    recoverabilityPoints -= 1;
    const names = alternates
      .map((id) => index.entityById.get(id)?.name ?? id)
      .join(', ');
    reasons.push({
      code: 'recoverability.alternate',
      dimension: 'recoverability',
      statement: `"${subject.name}" has a recorded alternative (${names}), which reduces how badly a failure lands.`,
      contribution: -1,
      confidence: 'KNOWN',
    });
  }
  if (subject.procedureDocumented === true) {
    recoverabilityPoints -= 1;
    reasons.push({
      code: 'recoverability.procedure',
      dimension: 'recoverability',
      statement: `A written procedure exists for "${subject.name}", so recovery does not depend on memory.`,
      contribution: -1,
      confidence: 'KNOWN',
    });
  }

  const lastTested = parseInstant(subject.lastTestedAt);
  if (lastTested !== null) {
    const age = daysBetween(lastTested, now);
    if (age <= TEST_FRESHNESS_DAYS) {
      recoverabilityPoints -= 1;
      reasons.push({
        code: 'recoverability.tested',
        dimension: 'recoverability',
        statement: `Recovery for "${subject.name}" was last proven ${age} day(s) ago, within the ${TEST_FRESHNESS_DAYS}-day freshness window.`,
        contribution: -1,
        confidence: 'KNOWN',
      });
    } else {
      reasons.push({
        code: 'recoverability.stale_test',
        dimension: 'recoverability',
        statement: `Recovery for "${subject.name}" was last proven ${age} day(s) ago, beyond the ${TEST_FRESHNESS_DAYS}-day freshness window, so it counts as unproven.`,
        contribution: 0,
        confidence: 'UNVERIFIED',
      });
    }
  } else {
    reasons.push({
      code: 'recoverability.never_tested',
      dimension: 'recoverability',
      statement: `There is no record of recovery for "${subject.name}" ever being tested.`,
      contribution: 0,
      confidence: 'UNKNOWN',
    });
  }

  recoverabilityPoints = Math.max(0, recoverabilityPoints);
  if (recoverabilityPoints > 0) {
    reasons.push({
      code: 'recoverability.gap',
      dimension: 'recoverability',
      statement: `Taken together, recovery for "${subject.name}" is only partly established, adding ${recoverabilityPoints} point(s).`,
      contribution: recoverabilityPoints,
      confidence: 'KNOWN',
    });
  }

  // ---- Currency of contacts and access ------------------------------------
  let currencyPoints = 0;
  const contactsVerified = parseInstant(subject.contactsVerifiedAt);
  const accessVerified = parseInstant(subject.accessVerifiedAt);

  if (contactsVerified === null || daysBetween(contactsVerified, now) > CURRENCY_FRESHNESS_DAYS) {
    currencyPoints += 1;
    reasons.push({
      code: 'currency.contacts',
      dimension: 'currency',
      statement:
        contactsVerified === null
          ? `Contact details for "${subject.name}" have never been confirmed.`
          : `Contact details for "${subject.name}" were last confirmed ${daysBetween(contactsVerified, now)} day(s) ago.`,
      contribution: 1,
      confidence: contactsVerified === null ? 'UNKNOWN' : 'UNVERIFIED',
    });
  }
  if (accessVerified === null || daysBetween(accessVerified, now) > CURRENCY_FRESHNESS_DAYS) {
    currencyPoints += 1;
    reasons.push({
      code: 'currency.access',
      dimension: 'currency',
      statement:
        accessVerified === null
          ? `Credentials and access for "${subject.name}" have never been confirmed working.`
          : `Credentials and access for "${subject.name}" were last confirmed ${daysBetween(accessVerified, now)} day(s) ago.`,
      contribution: 1,
      confidence: accessVerified === null ? 'UNKNOWN' : 'UNVERIFIED',
    });
  }

  // ---- Sharpness of the finding kind --------------------------------------
  let sharpnessPoints = 0;
  if (SHARP_FINDING_KINDS.has(findingKind)) {
    sharpnessPoints = 1;
    reasons.push({
      code: 'sharpness.kind',
      dimension: 'sharpness',
      statement: `This is a ${findingKind.replace(/_/g, ' ')} weakness, which typically cannot be substituted at short notice.`,
      contribution: 1,
      confidence: 'KNOWN',
    });
  }

  const score =
    impactPoints + concentrationPoints + recoverabilityPoints + currencyPoints + sharpnessPoints;

  let band = bandForScore(score);
  let overrideRule: string | undefined;

  // Hard rule: a critical function with nothing standing behind it is critical
  // however the arithmetic lands.
  if (
    highestCriticality === 'CRITICAL' &&
    peakFunction !== null &&
    recoverabilityPoints === WEIGHTS.recoverability
  ) {
    if (band !== 'CRITICAL') {
      overrideRule =
        'A CRITICAL business function depends on this and there is no alternative, no written procedure and no proven recovery.';
    }
    band = 'CRITICAL';
  }

  // Hard rule: nothing depends on it, so it cannot be more than LOW however
  // stale its paperwork is.
  if (dependentIds.length === 0 && band !== 'LOW') {
    overrideRule = 'Nothing recorded depends on this entity, so it cannot carry more than LOW risk.';
    band = 'LOW';
  }

  const assessment: RiskAssessment = {
    band,
    score,
    maxScore: MAX_SCORE,
    reasons,
    ...(overrideRule === undefined ? {} : { overrideRule }),
  };
  return assessment;
}

/**
 * Convenience for callers that only hold an id. Returns null when the entity is
 * unknown rather than inventing a subject.
 */
export function assessEntityRiskById(
  index: GraphIndex,
  entityId: string,
  findingKind: FindingKind,
  now: Date,
): RiskAssessment | null {
  const subject = index.entityById.get(entityId);
  if (subject === undefined) return null;
  return assessEntityRisk({ index, subject, findingKind, now });
}

/** Highest of two bands, used when several findings roll up to one entity. */
export function worstBand(a: RiskBand, b: RiskBand): RiskBand {
  return RISK_BAND_RANK[a] >= RISK_BAND_RANK[b] ? a : b;
}

/**
 * The criticality this entity effectively carries, re-exported here because
 * risk reporting almost always needs it alongside the band.
 */
export { effectiveCriticality };
