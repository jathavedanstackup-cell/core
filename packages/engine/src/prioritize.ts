/**
 * Prioritisation.
 *
 * An assessment of a real organization produces dozens of findings. Handing a
 * leadership team fifty recommendations is the same as handing them none, so
 * the engine sorts them into three tiers and caps the top two.
 *
 * The ranking deliberately rewards cheap fixes. A MODERATE weakness that one
 * person can close this week is often worth more than a CRITICAL one that needs
 * a year of procurement, and the tiering should reflect that rather than
 * sorting purely by severity.
 */

import type { GraphIndex } from './graph.js';
import { generateSolutions } from './solutions.js';
import {
  MAGNITUDE_RANK,
  RISK_BAND_RANK,
  type Finding,
  type PrioritizedFinding,
  type PriorityTier,
  type SolutionOption,
  type SolutionSet,
} from './types.js';

/** How many findings may appear in each of the actionable tiers. */
export const TIER_LIMITS: Readonly<Record<'FIX_FIRST' | 'FIX_NEXT', number>> = Object.freeze({
  FIX_FIRST: 3,
  FIX_NEXT: 5,
});

function burden(option: SolutionOption): number {
  const { cost, effort, time, disruption } = option.tradeOffs;
  return (
    MAGNITUDE_RANK[cost] + MAGNITUDE_RANK[effort] + MAGNITUDE_RANK[time] + MAGNITUDE_RANK[disruption]
  );
}

export interface PrioritizeOptions {
  /** Pre-computed solution sets, keyed by finding id, to avoid regenerating. */
  readonly solutions?: ReadonlyMap<string, SolutionSet>;
}

/**
 * Rank findings and assign tiers.
 *
 * `valueScore` is an internal ordering aid, not a business metric, and is
 * deliberately not surfaced as a score to users; the tier and the rationale are
 * what get shown.
 */
export function prioritize(
  index: GraphIndex,
  findings: readonly Finding[],
  options: PrioritizeOptions = {},
): PrioritizedFinding[] {
  const scored = findings.map((finding) => {
    const solutionSet =
      options.solutions?.get(finding.id) ?? safeGenerate(index, finding);
    const recommended = solutionSet?.options.find(
      (option) => option.id === solutionSet.recommendedOptionId,
    );

    const severity = RISK_BAND_RANK[finding.risk.band] * 4;
    const reach = Math.min(finding.criticalDependentIds.length, 3) * 2;
    const effectiveness = recommended?.riskReduction ?? 0;
    // Halved so that cost breaks ties between comparable fixes without ever
    // outranking severity on its own.
    const cheapness = recommended === undefined ? 0 : (6 - burden(recommended)) / 2;

    const valueScore = severity + reach + effectiveness + cheapness;

    const rationaleParts = [
      `${finding.risk.band} risk`,
      finding.criticalDependentIds.length > 0
        ? `${finding.criticalDependentIds.length} critical business function(s) affected`
        : 'no critical business function directly affected',
    ];
    if (recommended !== undefined) {
      rationaleParts.push(
        `the recommended fix removes ${recommended.riskReduction} of 3 and costs ${recommended.tradeOffs.cost.toLowerCase()} to carry out`,
      );
    }

    return {
      finding,
      valueScore,
      rationale: capitalise(`${rationaleParts.join('; ')}.`),
    };
  });

  scored.sort(
    (a, b) =>
      b.valueScore - a.valueScore ||
      RISK_BAND_RANK[b.finding.risk.band] - RISK_BAND_RANK[a.finding.risk.band] ||
      a.finding.subjectName.localeCompare(b.finding.subjectName),
  );

  return scored.map((item, position) => ({
    finding: item.finding,
    tier: tierFor(position, item.finding),
    valueScore: item.valueScore,
    rationale: item.rationale,
  }));
}

/**
 * Nothing below MODERATE is ever put in an actionable tier, however cheap it is
 * to fix; a leadership team should not be asked to act on LOW risk.
 */
function tierFor(position: number, finding: Finding): PriorityTier {
  if (RISK_BAND_RANK[finding.risk.band] < RISK_BAND_RANK.MODERATE) return 'MONITOR';
  if (position < TIER_LIMITS.FIX_FIRST) return 'FIX_FIRST';
  if (position < TIER_LIMITS.FIX_FIRST + TIER_LIMITS.FIX_NEXT) return 'FIX_NEXT';
  return 'MONITOR';
}

function safeGenerate(index: GraphIndex, finding: Finding): SolutionSet | undefined {
  try {
    return generateSolutions(index, finding);
  } catch {
    // A finding whose subject has since disappeared should not break the whole
    // prioritisation; it simply ranks without a solution contribution.
    return undefined;
  }
}

function capitalise(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

/** Group prioritised findings by tier, preserving rank order within each. */
export function groupByTier(
  prioritized: readonly PrioritizedFinding[],
): Record<PriorityTier, PrioritizedFinding[]> {
  const grouped: Record<PriorityTier, PrioritizedFinding[]> = {
    FIX_FIRST: [],
    FIX_NEXT: [],
    MONITOR: [],
  };
  for (const item of prioritized) grouped[item.tier].push(item);
  return grouped;
}
