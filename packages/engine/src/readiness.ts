/**
 * Readiness assessment: is the organization actually prepared for this thing to
 * fail, as opposed to having a document that says it is?
 *
 * Each check reports one of three outcomes rather than two. "Failed" means we
 * checked and the answer is no. "Unknown" means nobody has recorded an answer,
 * which is a different problem with a different fix, and is never quietly
 * counted as a pass.
 */

import { buildIndex, transitiveDependents, type GraphIndex } from './graph.js';
import { CURRENCY_FRESHNESS_DAYS, TEST_FRESHNESS_DAYS } from './risk.js';
import {
  CRITICALITY_RANK,
  type Entity,
  type OrganizationGraph,
  type ReadinessAssessment,
  type ReadinessCheck,
  type ReadinessState,
} from './types.js';

function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (iso == null) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor((now.getTime() - parsed.getTime()) / 86_400_000);
}

function check(
  code: string,
  label: string,
  outcome: { passed: boolean; unknown: boolean },
  detail: string,
): ReadinessCheck {
  return { code, label, passed: outcome.passed, unknown: outcome.unknown, detail };
}

const PASS = { passed: true, unknown: false };
const FAIL = { passed: false, unknown: false };
const UNKNOWN = { passed: false, unknown: true };

export interface ReadinessOptions {
  readonly now?: Date;
}

/**
 * Assess one entity.
 *
 * Checks that do not apply to the entity kind are omitted entirely rather than
 * auto-passed, so a person is not credited with having a recovery time
 * objective they were never supposed to have.
 */
export function assessReadiness(
  graph: OrganizationGraph,
  entityId: string,
  options: ReadinessOptions = {},
): ReadinessAssessment | null {
  const index = buildIndex(graph);
  const entity = index.entityById.get(entityId);
  if (entity === undefined) return null;
  return assessReadinessWithIndex(index, entity, options.now ?? new Date());
}

export function assessReadinessWithIndex(
  index: GraphIndex,
  entity: Entity,
  now: Date,
): ReadinessAssessment {
  const checks: ReadinessCheck[] = [];
  const isPerson = entity.kind === 'person';
  const isFunction = entity.kind === 'business_function';

  // --- accountability ------------------------------------------------------
  if (!isPerson) {
    const owner = entity.ownerId == null ? undefined : index.entityById.get(entity.ownerId);
    checks.push(
      check(
        'owner_exists',
        'Someone is accountable',
        entity.ownerId == null ? FAIL : owner === undefined ? FAIL : PASS,
        entity.ownerId == null
          ? 'No owner is recorded.'
          : owner === undefined
            ? `The recorded owner "${entity.ownerId}" is not a person in this organization.`
            : `${owner.name} is accountable.`,
      ),
    );

    if (owner !== undefined) {
      const deputies = (owner.alternateIds ?? []).filter((id) => index.entityById.has(id));
      checks.push(
        check(
          'owner_backup_exists',
          'The owner has a backup',
          deputies.length > 0 ? PASS : FAIL,
          deputies.length > 0
            ? `${deputies.map((id) => index.entityById.get(id)?.name ?? id).join(', ')} can cover for ${owner.name}.`
            : `Nobody is recorded as able to cover for ${owner.name}.`,
        ),
      );
    }
  }

  // --- substitutability ----------------------------------------------------
  const alternates = (entity.alternateIds ?? []).filter((id) => index.entityById.has(id));
  checks.push(
    check(
      'alternate_exists',
      'An alternative exists',
      alternates.length > 0 ? PASS : FAIL,
      alternates.length > 0
        ? `${alternates.map((id) => index.entityById.get(id)?.name ?? id).join(', ')} can stand in.`
        : 'No alternative is recorded.',
    ),
  );

  // --- documented -----------------------------------------------------------
  checks.push(
    check(
      'procedure_exists',
      'There is a written procedure',
      entity.procedureDocumented === true ? PASS : entity.procedureDocumented === false ? FAIL : UNKNOWN,
      entity.procedureDocumented === true
        ? 'A written procedure is recorded.'
        : entity.procedureDocumented === false
          ? 'There is no written procedure.'
          : 'Nobody has recorded whether a written procedure exists.',
    ),
  );

  // --- targets --------------------------------------------------------------
  if (isFunction) {
    checks.push(
      check(
        'recovery_target_exists',
        'Recovery targets are agreed',
        entity.rtoMinutes != null && entity.mtdMinutes != null ? PASS : FAIL,
        entity.rtoMinutes != null && entity.mtdMinutes != null
          ? `Tolerable downtime ${entity.mtdMinutes} min, recovery target ${entity.rtoMinutes} min.`
          : 'No agreed recovery target or tolerable downtime.',
      ),
    );

    if (entity.rtoMinutes != null && entity.mtdMinutes != null) {
      checks.push(
        check(
          'recovery_target_achievable',
          'The recovery target fits the tolerance',
          entity.rtoMinutes <= entity.mtdMinutes ? PASS : FAIL,
          entity.rtoMinutes <= entity.mtdMinutes
            ? 'The recovery target is within what the business can tolerate.'
            : `The recovery target of ${entity.rtoMinutes} min exceeds the ${entity.mtdMinutes} min the business can tolerate.`,
        ),
      );
    }
  }

  // --- proven ---------------------------------------------------------------
  const testAge = daysSince(entity.lastTestedAt, now);
  checks.push(
    check(
      'recently_tested',
      'Recovery has been proven recently',
      testAge === null ? UNKNOWN : testAge <= TEST_FRESHNESS_DAYS ? PASS : FAIL,
      testAge === null
        ? 'There is no record of recovery ever being tested.'
        : testAge <= TEST_FRESHNESS_DAYS
          ? `Last proven ${testAge} days ago.`
          : `Last proven ${testAge} days ago, beyond the ${TEST_FRESHNESS_DAYS}-day window.`,
    ),
  );

  // --- current --------------------------------------------------------------
  const contactAge = daysSince(entity.contactsVerifiedAt, now);
  checks.push(
    check(
      'contacts_current',
      'Contact details are current',
      contactAge === null ? UNKNOWN : contactAge <= CURRENCY_FRESHNESS_DAYS ? PASS : FAIL,
      contactAge === null
        ? 'Contact details have never been confirmed.'
        : `Contact details confirmed ${contactAge} days ago.`,
    ),
  );

  const accessAge = daysSince(entity.accessVerifiedAt, now);
  checks.push(
    check(
      'access_current',
      'Access and credentials are current',
      accessAge === null ? UNKNOWN : accessAge <= CURRENCY_FRESHNESS_DAYS ? PASS : FAIL,
      accessAge === null
        ? 'Access and credentials have never been confirmed working.'
        : `Access confirmed ${accessAge} days ago.`,
    ),
  );

  // --- understood -----------------------------------------------------------
  const providers = index.outgoing.get(entity.id) ?? [];
  if (!isPerson) {
    checks.push(
      check(
        'dependencies_known',
        'What it depends on is known',
        providers.length > 0 ? PASS : UNKNOWN,
        providers.length > 0
          ? `${providers.length} dependency/dependencies recorded.`
          : 'Nothing is recorded about what this depends on, so the analysis may be incomplete.',
      ),
    );
  }

  const applicableCount = checks.length;
  const passedCount = checks.filter((c) => c.passed).length;
  const unknownCount = checks.filter((c) => c.unknown).length;
  const ratio = applicableCount === 0 ? 1 : passedCount / applicableCount;

  let state: ReadinessState;
  if (ratio >= 1 && unknownCount === 0) {
    state = 'READY';
  } else if (ratio >= 0.7) {
    state = 'PARTIAL';
  } else if (ratio >= 0.4) {
    state = 'AT_RISK';
  } else {
    state = 'CRITICAL';
  }

  // An important thing with nobody accountable and nothing to fall back on is
  // not merely partly ready, whatever the other checks say.
  const declared = entity.criticality ?? 'LOW';
  const matters =
    CRITICALITY_RANK[declared] >= CRITICALITY_RANK.HIGH ||
    transitiveDependents(index, entity.id).some((id) => {
      const dependent = index.entityById.get(id);
      const c = dependent?.criticality ?? 'LOW';
      return CRITICALITY_RANK[c] >= CRITICALITY_RANK.HIGH;
    });

  const ownerCheck = checks.find((c) => c.code === 'owner_exists');
  const alternateCheck = checks.find((c) => c.code === 'alternate_exists');
  if (
    matters &&
    ownerCheck !== undefined &&
    !ownerCheck.passed &&
    alternateCheck !== undefined &&
    !alternateCheck.passed
  ) {
    state = 'CRITICAL';
  }

  const failedLabels = checks.filter((c) => !c.passed && !c.unknown).map((c) => c.label);
  const summary =
    state === 'READY'
      ? `"${entity.name}" passes all ${applicableCount} readiness checks.`
      : `"${entity.name}" passes ${passedCount} of ${applicableCount} readiness checks.` +
        (failedLabels.length > 0 ? ` Not met: ${failedLabels.join('; ')}.` : '') +
        (unknownCount > 0 ? ` ${unknownCount} check(s) have no recorded answer.` : '');

  return {
    subjectId: entity.id,
    state,
    checks,
    passedCount,
    applicableCount,
    unknownCount,
    summary,
  };
}

/** Assess every entity worth assessing, worst first. */
export function assessOrganizationReadiness(
  graph: OrganizationGraph,
  options: ReadinessOptions = {},
): ReadinessAssessment[] {
  const index = buildIndex(graph);
  const now = options.now ?? new Date();
  const RANK: Record<ReadinessState, number> = {
    CRITICAL: 0,
    AT_RISK: 1,
    PARTIAL: 2,
    READY: 3,
  };

  return index.graph.entities
    .map((entity) => assessReadinessWithIndex(index, entity, now))
    .sort((a, b) => {
      const byState = RANK[a.state] - RANK[b.state];
      if (byState !== 0) return byState;
      return a.subjectId.localeCompare(b.subjectId);
    });
}
