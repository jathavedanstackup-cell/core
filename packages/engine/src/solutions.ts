/**
 * Solution generation.
 *
 * Diagnosis without a recommendation is the failure mode this product exists to
 * avoid, so every finding must yield options, trade-offs, a recommendation with
 * a stated reason, concrete actions and a way to verify the fix worked.
 *
 * Options are built against the real organization, not a template. A
 * cross-training option names the actual colleague who could be trained; if the
 * graph contains no such colleague the option is not offered, because offering
 * it would be advice the organization cannot act on.
 */

import { criticalBusinessFunctions, transitiveDependents, type GraphIndex } from './graph.js';
import {
  MAGNITUDE_RANK,
  type ActionTemplate,
  type Entity,
  type Finding,
  type Magnitude,
  type SolutionOption,
  type SolutionSet,
  type TradeOffs,
} from './types.js';

interface SolutionContext {
  readonly index: GraphIndex;
  readonly finding: Finding;
  readonly subject: Entity;
  /** Critical business functions that stop when the subject does. */
  readonly atRisk: readonly Entity[];
  /** Readable list of the top few at-risk function names. */
  readonly atRiskPhrase: string;
  readonly ownerName: string;
}

function tradeOffs(
  cost: Magnitude,
  effort: Magnitude,
  time: Magnitude,
  operationalRisk: Magnitude,
  disruption: Magnitude,
): TradeOffs {
  return { cost, effort, time, operationalRisk, disruption };
}

/** People the same teams rely on, excluding the subject. Used for cover options. */
function colleaguesOf(index: GraphIndex, personId: string): Entity[] {
  const colleagues = new Map<string, Entity>();
  for (const teamDependency of index.incoming.get(personId) ?? []) {
    const team = index.entityById.get(teamDependency.dependentId);
    if (team?.kind !== 'team') continue;
    for (const memberDependency of index.outgoing.get(team.id) ?? []) {
      if (memberDependency.providerId === personId) continue;
      const member = index.entityById.get(memberDependency.providerId);
      if (member?.kind === 'person') colleagues.set(member.id, member);
    }
  }
  return [...colleagues.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Other entities of the same kind that could plausibly be a second source. */
function peersOf(index: GraphIndex, entity: Entity): Entity[] {
  return index.graph.entities
    .filter((candidate) => candidate.kind === entity.kind && candidate.id !== entity.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function listNames(entities: readonly Entity[], limit = 3): string {
  const names = entities.slice(0, limit).map((e) => `"${e.name}"`);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// --------------------------------------------------------------------------
// Option builders, one family per finding kind.
// --------------------------------------------------------------------------

function singlePersonOptions(context: SolutionContext): SolutionOption[] {
  const { index, subject, atRiskPhrase, ownerName } = context;
  const options: SolutionOption[] = [];
  const colleagues = colleaguesOf(index, subject.id);

  if (colleagues.length > 0) {
    const candidate = colleagues[0];
    const candidateName = candidate?.name ?? 'a colleague';
    options.push({
      id: 'cross_train',
      title: `Cross-train ${candidateName} to cover ${subject.name}`,
      description:
        `${subject.name} is currently the only person who can keep ${atRiskPhrase} running. ` +
        `${candidateName} already works alongside them and is the shortest path to a second pair of hands. ` +
        `This removes the dependency on one individual without changing any system.`,
      tradeOffs: tradeOffs('LOW', 'MEDIUM', 'MEDIUM', 'LOW', 'LOW'),
      riskReduction: 3,
      preconditions: [`${candidateName} has capacity to take on this responsibility.`],
      actions: buildActions([
        {
          title: `Have ${subject.name} walk ${candidateName} through the full process`,
          ownerName: subject.name,
          priority: 'P1',
          verification: `${candidateName} can describe the process unaided.`,
        },
        {
          title: `Have ${candidateName} run the process once with ${subject.name} observing`,
          ownerName: candidateName,
          priority: 'P1',
          verification: `${candidateName} completed a real run with no intervention.`,
        },
        {
          title: `Record ${candidateName} as the backup for ${subject.name}`,
          ownerName: ownerName,
          priority: 'P2',
          verification: `The organization record shows ${candidateName} as an alternate.`,
        },
      ]),
      verification: `${candidateName} independently completes the process end to end while ${subject.name} is unavailable.`,
    });
  }

  options.push({
    id: 'document_procedure',
    title: `Write down how ${subject.name} does this`,
    description:
      `The fastest partial mitigation. A written procedure means that if ${subject.name} is unavailable, ` +
      `somebody competent can follow the steps rather than reconstruct them under pressure. ` +
      `It does not remove the dependency, but it shortens recovery substantially.`,
    tradeOffs: tradeOffs('LOW', 'LOW', 'LOW', 'LOW', 'LOW'),
    riskReduction: 1,
    preconditions: [],
    actions: buildActions([
      {
        title: `Draft the step-by-step procedure`,
        ownerName: subject.name,
        priority: 'P1',
        verification: 'A written procedure exists and is stored where others can reach it.',
      },
      {
        title: `Have someone unfamiliar with the process follow the draft`,
        ownerName: ownerName,
        priority: 'P2',
        verification: 'A reviewer completed the process from the document alone.',
      },
    ]),
    verification: 'Someone other than the author completes the process using only the document.',
  });

  options.push({
    id: 'automate_steps',
    title: `Automate the steps only ${subject.name} can perform`,
    description:
      `Removes the human dependency permanently for the mechanical parts of the work. ` +
      `This is the most durable fix and the most expensive one; it is usually worth doing only for the ` +
      `steps that are both routine and on the critical path.`,
    tradeOffs: tradeOffs('HIGH', 'HIGH', 'HIGH', 'MEDIUM', 'MEDIUM'),
    riskReduction: 3,
    preconditions: [
      'The steps are deterministic enough to automate.',
      'Engineering capacity is available.',
    ],
    actions: buildActions([
      {
        title: 'Identify which steps are mechanical and which need judgement',
        ownerName: subject.name,
        priority: 'P2',
        verification: 'A written split of automatable versus judgement steps exists.',
      },
      {
        title: 'Build and test the automation for the mechanical steps',
        ownerName: ownerName,
        priority: 'P3',
        verification: 'The automation runs successfully without manual intervention.',
      },
    ]),
    verification: 'The automated steps run to completion without the named individual.',
  });

  return options;
}

function singleVendorOptions(context: SolutionContext): SolutionOption[] {
  const { index, subject, atRiskPhrase, ownerName } = context;
  const options: SolutionOption[] = [];
  const peers = peersOf(index, subject);

  options.push({
    id: 'second_source',
    title: `Add a second supplier alongside ${subject.name}`,
    description:
      `${atRiskPhrase} currently depends on ${subject.name} with no alternative. ` +
      `A contracted second source removes the single point entirely.` +
      (peers.length > 0
        ? ` The organization already works with ${listNames(peers)}, which may shorten procurement.`
        : ''),
    tradeOffs: tradeOffs('HIGH', 'MEDIUM', 'HIGH', 'LOW', 'LOW'),
    riskReduction: 3,
    preconditions: ['Budget exists for a second supplier relationship.'],
    actions: buildActions([
      {
        title: `Identify candidate alternatives to ${subject.name}`,
        ownerName,
        priority: 'P1',
        verification: 'A shortlist of viable alternative suppliers exists.',
      },
      {
        title: 'Agree commercial terms and integrate the alternative',
        ownerName,
        priority: 'P2',
        verification: 'A contract is signed and a test transaction has succeeded.',
      },
    ]),
    verification: `A real transaction completes through the alternative supplier while ${subject.name} is not used.`,
  });

  options.push({
    id: 'manual_fallback',
    title: `Agree a manual fallback for when ${subject.name} is unavailable`,
    description:
      `A documented, rehearsed manual process that keeps ${atRiskPhrase} moving at reduced volume. ` +
      `Far cheaper and faster than a second supplier, and it buys time rather than removing the dependency.`,
    tradeOffs: tradeOffs('LOW', 'MEDIUM', 'LOW', 'MEDIUM', 'LOW'),
    riskReduction: 2,
    preconditions: ['The work can be performed manually at reduced volume.'],
    actions: buildActions([
      {
        title: 'Write the manual fallback procedure and agree who runs it',
        ownerName,
        priority: 'P1',
        verification: 'A named owner and a written fallback procedure exist.',
      },
      {
        title: 'Rehearse the fallback once end to end',
        ownerName,
        priority: 'P2',
        verification: 'A rehearsal completed and its duration was recorded.',
      },
    ]),
    verification: `The fallback is rehearsed successfully and its throughput is recorded against what ${atRiskPhrase} needs.`,
  });

  options.push({
    id: 'contractual_guarantee',
    title: `Strengthen the recovery commitments in the ${subject.name} contract`,
    description:
      `Does not remove the dependency, but makes the supplier's obligations explicit and enforceable, ` +
      `and gives the organization a defined recovery time to plan against.`,
    tradeOffs: tradeOffs('LOW', 'LOW', 'MEDIUM', 'LOW', 'LOW'),
    riskReduction: 1,
    preconditions: ['The contract is open for renegotiation.'],
    actions: buildActions([
      {
        title: `Review the ${subject.name} contract for recovery and availability commitments`,
        ownerName,
        priority: 'P2',
        verification: 'The contract terms are documented against the required recovery target.',
      },
    ]),
    verification: 'The contract states a recovery commitment at least as strong as the business requires.',
  });

  return options;
}

function singleSystemOptions(context: SolutionContext): SolutionOption[] {
  const { subject, atRiskPhrase, ownerName } = context;
  return [
    {
      id: 'redundancy',
      title: `Run ${subject.name} with a standby instance`,
      description:
        `${atRiskPhrase} stops when ${subject.name} does. A standby that can take over removes the ` +
        `single point rather than shortening it.`,
      tradeOffs: tradeOffs('HIGH', 'HIGH', 'MEDIUM', 'MEDIUM', 'MEDIUM'),
      riskReduction: 3,
      preconditions: ['The system supports running more than one instance.'],
      actions: buildActions([
        {
          title: `Provision a standby for ${subject.name}`,
          ownerName,
          priority: 'P1',
          verification: 'A standby exists and is receiving current data.',
        },
        {
          title: 'Test failover to the standby under load',
          ownerName,
          priority: 'P1',
          verification: 'A failover test succeeded within the recovery target.',
        },
      ]),
      verification: `Failover to the standby completes within the recovery target for ${atRiskPhrase}.`,
    },
    {
      id: 'restore_capability',
      title: `Prove that ${subject.name} can be restored from backup`,
      description:
        `Cheaper than redundancy and much better than nothing. The organization keeps a single instance ` +
        `but knows, from evidence rather than assumption, how long a restore takes.`,
      tradeOffs: tradeOffs('LOW', 'MEDIUM', 'LOW', 'LOW', 'LOW'),
      riskReduction: 2,
      preconditions: ['Backups of the system exist.'],
      actions: buildActions([
        {
          title: `Restore ${subject.name} into an isolated environment and time it`,
          ownerName,
          priority: 'P1',
          verification: 'A restore completed and its duration was recorded.',
        },
        {
          title: 'Compare the measured restore time against the recovery target',
          ownerName,
          priority: 'P2',
          verification: 'The gap between measured and required recovery time is documented.',
        },
      ]),
      verification: 'A timed restore completes and the duration is recorded against the recovery target.',
    },
    {
      id: 'degraded_mode',
      title: `Define how ${atRiskPhrase} runs without ${subject.name}`,
      description:
        `Accepts that the system may be unavailable and designs for it: a reduced but functioning mode. ` +
        `Usually the fastest way to reduce business impact when redundancy is not affordable.`,
      tradeOffs: tradeOffs('LOW', 'MEDIUM', 'MEDIUM', 'MEDIUM', 'LOW'),
      riskReduction: 2,
      preconditions: ['The dependent work can be performed in a reduced form.'],
      actions: buildActions([
        {
          title: 'Document what still works and what stops',
          ownerName,
          priority: 'P2',
          verification: 'A written degraded-mode description exists.',
        },
      ]),
      verification: `The degraded mode is exercised and the business confirms it is acceptable for the agreed duration.`,
    },
  ];
}

function singleLocationOptions(context: SolutionContext): SolutionOption[] {
  const { index, subject, atRiskPhrase, ownerName } = context;
  const peers = peersOf(index, subject);
  return [
    {
      id: 'alternate_site',
      title: `Nominate an alternate site for ${subject.name}`,
      description:
        `${atRiskPhrase} depends on ${subject.name} being usable. Naming and preparing an alternate ` +
        `site means an evacuation is a relocation rather than a stoppage.` +
        (peers.length > 0 ? ` ${listNames(peers)} may be suitable.` : ''),
      tradeOffs: tradeOffs('MEDIUM', 'MEDIUM', 'MEDIUM', 'LOW', 'LOW'),
      riskReduction: 3,
      preconditions: ['Another site with sufficient capacity is available.'],
      actions: buildActions([
        {
          title: 'Confirm the alternate site and its capacity',
          ownerName,
          priority: 'P1',
          verification: 'A named alternate site with confirmed capacity is recorded.',
        },
        {
          title: 'Run a relocation exercise for the critical teams',
          ownerName,
          priority: 'P2',
          verification: 'Teams worked from the alternate site for a full day.',
        },
      ]),
      verification: `Critical work continues from the alternate site for a full working day.`,
    },
    {
      id: 'remote_capability',
      title: `Make the work at ${subject.name} location-independent`,
      description:
        `Where the work does not physically require the site, removing the location dependency entirely ` +
        `is cheaper and more durable than maintaining a second building.`,
      tradeOffs: tradeOffs('MEDIUM', 'MEDIUM', 'MEDIUM', 'LOW', 'LOW'),
      riskReduction: 3,
      preconditions: ['The work does not physically require this site.'],
      actions: buildActions([
        {
          title: 'Identify which work genuinely requires the site',
          ownerName,
          priority: 'P1',
          verification: 'A written split of site-bound and location-independent work exists.',
        },
      ]),
      verification: 'The location-independent work is performed away from the site for a full day.',
    },
  ];
}

function ownerOptions(context: SolutionContext): SolutionOption[] {
  const { subject } = context;
  return [
    {
      id: 'assign_owner',
      title: `Assign an accountable owner for ${subject.name}`,
      description:
        `Nobody is currently accountable for ${subject.name}. Until someone is, no other improvement ` +
        `here has anyone to carry it, and in an incident there is nobody to call.`,
      tradeOffs: tradeOffs('LOW', 'LOW', 'LOW', 'LOW', 'LOW'),
      riskReduction: 2,
      preconditions: [],
      actions: buildActions([
        {
          title: `Name the accountable owner for ${subject.name}`,
          ownerName: 'Leadership',
          priority: 'P1',
          verification: 'A named owner is recorded and has accepted the responsibility.',
        },
      ]),
      verification: `A named person has accepted accountability for ${subject.name}.`,
    },
  ];
}

function testRecoveryOptions(context: SolutionContext): SolutionOption[] {
  const { subject, ownerName } = context;
  return [
    {
      id: 'run_test',
      title: `Test the recovery of ${subject.name}`,
      description:
        `A recovery plan that has never been executed is an assumption, not a capability. ` +
        `A single timed test converts it into evidence, and usually surfaces the steps that do not work.`,
      tradeOffs: tradeOffs('LOW', 'MEDIUM', 'LOW', 'LOW', 'LOW'),
      riskReduction: 2,
      preconditions: [],
      actions: buildActions([
        {
          title: `Schedule and run a recovery test for ${subject.name}`,
          ownerName,
          priority: 'P1',
          verification: 'A test was executed and its result and duration recorded.',
        },
        {
          title: 'Record what did not work and raise the gaps as actions',
          ownerName,
          priority: 'P2',
          verification: 'Every gap found in the test has an owner and a due date.',
        },
      ]),
      verification: `A recovery test completes and its duration is recorded against the recovery target.`,
    },
  ];
}

function procedureOptions(context: SolutionContext): SolutionOption[] {
  const { subject, ownerName } = context;
  return [
    {
      id: 'write_procedure',
      title: `Write the operating and recovery procedure for ${subject.name}`,
      description:
        `Turns knowledge held by individuals into something the organization owns. ` +
        `Low cost and it is a precondition for almost every other improvement.`,
      tradeOffs: tradeOffs('LOW', 'LOW', 'LOW', 'LOW', 'LOW'),
      riskReduction: 1,
      preconditions: [],
      actions: buildActions([
        {
          title: `Draft the procedure for ${subject.name}`,
          ownerName,
          priority: 'P2',
          verification: 'A written procedure is stored where the responders can reach it.',
        },
      ]),
      verification: 'Someone who did not write the procedure follows it successfully.',
    },
  ];
}

function recoveryTargetOptions(context: SolutionContext): SolutionOption[] {
  const { subject } = context;
  return [
    {
      id: 'agree_targets',
      title: `Agree how long ${subject.name} can be down`,
      description:
        `Without an agreed tolerable downtime and recovery target there is no standard to design or ` +
        `test against, and no way to tell whether any recovery plan is good enough.`,
      tradeOffs: tradeOffs('LOW', 'LOW', 'LOW', 'LOW', 'LOW'),
      riskReduction: 2,
      preconditions: ['A business decision-maker is available to set the target.'],
      actions: buildActions([
        {
          title: `Agree maximum tolerable downtime and recovery target for ${subject.name}`,
          ownerName: 'Leadership',
          priority: 'P1',
          verification: 'Both figures are recorded and signed off by the business owner.',
        },
      ]),
      verification: `Recovery targets for ${subject.name} are recorded and agreed by the business.`,
    },
  ];
}

interface RawAction {
  title: string;
  ownerName: string;
  priority: 'P1' | 'P2' | 'P3';
  verification: string;
}

function toActionTemplate(raw: RawAction): ActionTemplate {
  return {
    title: raw.title,
    ownerHint: raw.ownerName,
    priority: raw.priority,
    verification: raw.verification,
  };
}

/**
 * Wrapping the array in a call gives the object literals inside it their
 * literal types, which a bare `[...].map(...)` would widen away.
 */
function buildActions(raw: readonly RawAction[]): ActionTemplate[] {
  return raw.map(toActionTemplate);
}

const BUILDERS: Readonly<Record<Finding['kind'], (context: SolutionContext) => SolutionOption[]>> =
  Object.freeze({
    single_person: singlePersonOptions,
    single_vendor: singleVendorOptions,
    single_system: singleSystemOptions,
    single_credential: singleSystemOptions,
    single_recovery_path: singleSystemOptions,
    single_location: singleLocationOptions,
    no_owner: ownerOptions,
    untested_recovery: testRecoveryOptions,
    no_procedure: procedureOptions,
    missing_recovery_target: recoveryTargetOptions,
  });

/**
 * Cheapness of an option, averaged over its cost dimensions.
 *
 * Lower is cheaper. Used only to break ties between options that reduce risk by
 * the same amount, so that the organization is not told to buy a second data
 * centre when writing a document would do.
 */
function burden(option: SolutionOption): number {
  const { cost, effort, time, disruption } = option.tradeOffs;
  return (
    MAGNITUDE_RANK[cost] + MAGNITUDE_RANK[effort] + MAGNITUDE_RANK[time] + MAGNITUDE_RANK[disruption]
  );
}

/**
 * Generate the full solution set for a finding.
 *
 * The recommendation prefers the largest risk reduction, and among equals the
 * least burdensome option. The rationale states which of those two rules
 * decided it, so the reader can disagree with the reasoning rather than just
 * the answer.
 */
export function generateSolutions(index: GraphIndex, finding: Finding): SolutionSet {
  const subject = index.entityById.get(finding.subjectId);
  if (subject === undefined) {
    throw new Error(`Cannot generate solutions: unknown entity "${finding.subjectId}".`);
  }

  const dependents = transitiveDependents(index, subject.id);
  const atRisk = criticalBusinessFunctions(index, dependents);
  const atRiskPhrase = atRisk.length > 0 ? listNames(atRisk) : 'the work that depends on it';
  const owner = subject.ownerId == null ? undefined : index.entityById.get(subject.ownerId);
  const ownerName = owner?.name ?? 'the accountable owner';

  const context: SolutionContext = {
    index,
    finding,
    subject,
    atRisk,
    atRiskPhrase,
    ownerName,
  };

  const build = BUILDERS[finding.kind];
  const options = build(context);
  if (options.length === 0) {
    throw new Error(`No solution options produced for finding "${finding.id}".`);
  }

  const ranked = [...options].sort(
    (a, b) => b.riskReduction - a.riskReduction || burden(a) - burden(b),
  );
  const recommended = ranked[0];
  if (recommended === undefined) {
    throw new Error(`No solution options produced for finding "${finding.id}".`);
  }

  const equallyEffective = ranked.filter((o) => o.riskReduction === recommended.riskReduction);
  const rationale =
    equallyEffective.length > 1
      ? `Of the ${equallyEffective.length} options that remove most of this weakness, this one costs the least to carry out.`
      : `This option removes more of the weakness than the alternatives (${recommended.riskReduction} of 3), which matters because ${
          atRisk.length > 0 ? `${atRiskPhrase} depend${atRisk.length === 1 ? 's' : ''} on it` : 'other recorded work depends on it'
        }.`;

  return {
    findingId: finding.id,
    problem: finding.summary,
    whyItMatters:
      atRisk.length > 0
        ? `${atRisk.length} business function(s) rated HIGH or CRITICAL stop if this is not addressed: ${listNames(atRisk, 5)}.`
        : `${finding.dependentIds.length} recorded item(s) depend on this.`,
    options: ranked,
    recommendedOptionId: recommended.id,
    recommendationRationale: rationale,
  };
}
