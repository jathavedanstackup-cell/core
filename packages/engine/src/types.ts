/**
 * Core domain vocabulary for C.O.R.E.
 *
 * Everything in this package is deterministic and side-effect free. No network,
 * no database, no clock reads except where a caller passes an explicit `now`.
 * That is deliberate: risk and readiness conclusions must be reproducible, and a
 * reviewer must be able to re-derive any conclusion from the inputs alone.
 */

/** The kinds of thing an organization is made of. */
export type EntityKind =
  | 'business_function'
  | 'process'
  | 'application'
  | 'service'
  | 'vendor'
  | 'team'
  | 'person'
  | 'location'
  | 'facility'
  | 'data_asset';

/** How much the organization cares if this stops working. */
export type Criticality = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';

/** Ordinal rank used for comparisons; higher means more critical. */
export const CRITICALITY_RANK: Readonly<Record<Criticality, number>> = Object.freeze({
  LOW: 0,
  MODERATE: 1,
  HIGH: 2,
  CRITICAL: 3,
});

export type RiskBand = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export const RISK_BAND_RANK: Readonly<Record<RiskBand, number>> = Object.freeze({
  LOW: 0,
  MODERATE: 1,
  HIGH: 2,
  CRITICAL: 3,
});

export type ReadinessState = 'READY' | 'PARTIAL' | 'AT_RISK' | 'CRITICAL';

/**
 * How much we actually know about a statement. C.O.R.E. must never present an
 * assumption as a fact, so every derived number carries one of these.
 */
export type Confidence = 'KNOWN' | 'ESTIMATED' | 'ASSUMED' | 'UNKNOWN' | 'UNVERIFIED';

/** Coarse ordinal used for cost / effort / time / disruption trade-offs. */
export type Magnitude = 'LOW' | 'MEDIUM' | 'HIGH';

export const MAGNITUDE_RANK: Readonly<Record<Magnitude, number>> = Object.freeze({
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
});

/**
 * A node in the organization graph.
 *
 * Optional fields mean "not recorded", which is materially different from a
 * recorded negative. `procedureDocumented: false` means someone checked and
 * there is no procedure; `undefined` means nobody has said. The readiness and
 * risk engines treat those two cases differently.
 */
export interface Entity {
  readonly id: string;
  readonly kind: EntityKind;
  readonly name: string;

  /** Declared importance. Usually set on business functions and inherited elsewhere. */
  readonly criticality?: Criticality;

  /** Person entity accountable for this. */
  readonly ownerId?: string | null;

  /** Entities that can stand in for this one if it becomes unavailable. */
  readonly alternateIds?: readonly string[];

  /** Whether a written procedure exists for operating or recovering this. */
  readonly procedureDocumented?: boolean;

  /** ISO-8601 instant this was last exercised or failed over for real. */
  readonly lastTestedAt?: string | null;

  /** ISO-8601 instant the contact list for this was last confirmed correct. */
  readonly contactsVerifiedAt?: string | null;

  /** ISO-8601 instant credentials / access for this were last confirmed working. */
  readonly accessVerifiedAt?: string | null;

  /** Maximum tolerable downtime, in minutes, before unacceptable harm. */
  readonly mtdMinutes?: number | null;

  /** Recovery time objective in minutes. */
  readonly rtoMinutes?: number | null;

  /** Recovery point objective in minutes of acceptable data loss. */
  readonly rpoMinutes?: number | null;

  readonly tags?: readonly string[];
}

/** The nature of a dependency, used for wording and for solution selection. */
export type DependencyType =
  | 'requires'
  | 'operates'
  | 'hosts'
  | 'supplies'
  | 'staffs'
  | 'stores'
  | 'authenticates';

/**
 * A directed dependency: `dependentId` needs `providerId`.
 *
 * Direction matters and is easy to get backwards, so it is named rather than
 * positional. Failure propagates from provider to dependent.
 */
export interface Dependency {
  readonly id: string;
  readonly dependentId: string;
  readonly providerId: string;
  readonly type: DependencyType;

  /** The dependent keeps working (possibly degraded) without the provider. */
  readonly optional?: boolean;

  /** Providers that can serve the dependent when the primary is unavailable. */
  readonly fallbackProviderIds?: readonly string[];

  /** How long the dependent can cope before it is itself considered failed. */
  readonly toleranceMinutes?: number | null;
}

/** The organization as an analysable graph. */
export interface OrganizationGraph {
  readonly entities: readonly Entity[];
  readonly dependencies: readonly Dependency[];
}

/**
 * One recorded step of reasoning behind a derived conclusion.
 *
 * Every risk band and readiness state is accompanied by these. If a conclusion
 * cannot be explained by its reasons, it is a bug.
 */
export interface Reason {
  /** Stable machine-readable code, safe to key translations or tests off. */
  readonly code: string;
  /** Which dimension of the assessment this speaks to. */
  readonly dimension: string;
  /** Plain sentence naming the real entities involved. */
  readonly statement: string;
  /** Points this contributed to the score. May be zero for context-only reasons. */
  readonly contribution: number;
  readonly confidence: Confidence;
}

/**
 * An explainable risk result.
 *
 * There is deliberately no percentage. A percentage would imply a calibrated
 * probability model that this system does not have. The band plus the reasons
 * is what we can actually defend.
 */
export interface RiskAssessment {
  readonly band: RiskBand;
  readonly score: number;
  readonly maxScore: number;
  readonly reasons: readonly Reason[];
  /** Set when a hard override rule determined the band regardless of score. */
  readonly overrideRule?: string;
}

/** The categories of weakness the engine can detect. */
export type FindingKind =
  | 'single_person'
  | 'single_vendor'
  | 'single_system'
  | 'single_location'
  | 'single_recovery_path'
  | 'single_credential'
  | 'no_owner'
  | 'untested_recovery'
  | 'no_procedure'
  | 'missing_recovery_target';

/** A specific, evidenced weakness about a specific entity. */
export interface Finding {
  readonly id: string;
  readonly kind: FindingKind;
  readonly subjectId: string;
  readonly subjectName: string;
  readonly subjectKind: EntityKind;
  /** Everything that transitively depends on the subject. */
  readonly dependentIds: readonly string[];
  /** The subset of dependents that are CRITICAL or HIGH business functions. */
  readonly criticalDependentIds: readonly string[];
  readonly risk: RiskAssessment;
  /** One sentence a non-technical executive can act on. */
  readonly summary: string;
}

/** Per-check detail behind a readiness state. */
export interface ReadinessCheck {
  readonly code: string;
  readonly label: string;
  readonly passed: boolean;
  /** True when the check could not be evaluated because data is absent. */
  readonly unknown: boolean;
  readonly detail: string;
}

export interface ReadinessAssessment {
  readonly subjectId: string;
  readonly state: ReadinessState;
  readonly checks: readonly ReadinessCheck[];
  readonly passedCount: number;
  readonly applicableCount: number;
  readonly unknownCount: number;
  readonly summary: string;
}

/** The cost side of a solution option. */
export interface TradeOffs {
  readonly cost: Magnitude;
  readonly effort: Magnitude;
  readonly time: Magnitude;
  readonly operationalRisk: Magnitude;
  readonly disruption: Magnitude;
}

export type ActionPriority = 'P1' | 'P2' | 'P3';

/** A concrete step, ready to become a tracked action record. */
export interface ActionTemplate {
  readonly title: string;
  /** Who should do this, expressed against the org (e.g. "owner of Payroll"). */
  readonly ownerHint: string;
  readonly priority: ActionPriority;
  /** How to confirm this specific step actually landed. */
  readonly verification: string;
}

export interface SolutionOption {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly tradeOffs: TradeOffs;
  /** Ordinal 0-3: how much of the underlying weakness this removes. */
  readonly riskReduction: number;
  /** What must be true in the organization for this option to be viable. */
  readonly preconditions: readonly string[];
  readonly actions: readonly ActionTemplate[];
  /** How the organization will know the weakness is actually gone. */
  readonly verification: string;
}

export interface SolutionSet {
  readonly findingId: string;
  readonly problem: string;
  readonly whyItMatters: string;
  readonly options: readonly SolutionOption[];
  readonly recommendedOptionId: string;
  readonly recommendationRationale: string;
}

export type PriorityTier = 'FIX_FIRST' | 'FIX_NEXT' | 'MONITOR';

export interface PrioritizedFinding {
  readonly finding: Finding;
  readonly tier: PriorityTier;
  readonly valueScore: number;
  readonly rationale: string;
}

/** How an entity is doing during a simulated or real failure. */
export type ImpactState = 'FAILED' | 'DEGRADED' | 'AT_RISK' | 'UNAFFECTED';

export interface ImpactedEntity {
  readonly entityId: string;
  readonly name: string;
  readonly kind: EntityKind;
  readonly state: ImpactState;
  /** Wave number: 0 is the originally failed set, 1 breaks first, and so on. */
  readonly wave: number;
  /** The dependency chain that carried the failure here, provider-first. */
  readonly path: readonly string[];
  /** Why this entity ended up in this state. */
  readonly explanation: string;
}

export interface ScenarioInput {
  /** Entities assumed unavailable at the start of the scenario. */
  readonly failedEntityIds: readonly string[];
  /** Human description of the situation being modelled. */
  readonly description?: string;
}

export interface ScenarioResult {
  readonly input: ScenarioInput;
  readonly impacted: readonly ImpactedEntity[];
  /** Impacted entities grouped by wave, ascending. Wave 0 is the trigger. */
  readonly waves: readonly (readonly ImpactedEntity[])[];
  /** Business functions that failed outright, most critical first. */
  readonly failedFunctions: readonly ImpactedEntity[];
  /** Dependencies that saved a dependent, worth naming in a report. */
  readonly fallbacksUsed: readonly {
    readonly dependentId: string;
    readonly failedProviderId: string;
    readonly fallbackProviderId: string;
  }[];
  /** Places where a fallback was needed and none existed. */
  readonly missingFallbacks: readonly {
    readonly dependentId: string;
    readonly failedProviderId: string;
  }[];
  /** Statements the caller should treat as assumptions, not facts. */
  readonly assumptions: readonly string[];
}
