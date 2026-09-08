/**
 * Report generation.
 *
 * Every report is built as one neutral document model — headings, paragraphs,
 * tables, bullets — and then rendered to JSON, CSV, HTML or PDF. That way a new
 * report kind needs one builder rather than four, and every format shows the
 * same content rather than four subtly different versions of it.
 *
 * Reports are written for a board or an operations lead, so the prose avoids
 * jargon, states its assumptions, and never presents an estimate as a fact.
 */

import { assessOrganizationReadiness, groupByTier, type Finding } from '@core/engine';
import { and, desc, eq } from 'drizzle-orm';

import { getDb } from '../db/client.js';
import {
  exerciseEvents,
  exercises,
  improvements,
  incidentEvents,
  incidents,
  type OrganizationRow,
} from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { assessOrganization, loadOrganizationGraph } from './orgGraph.js';

export type ReportKind =
  | 'risk'
  | 'readiness'
  | 'dependencies'
  | 'improvements'
  | 'exercise'
  | 'incident';

export interface Table {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface Section {
  readonly heading: string;
  readonly paragraphs?: readonly string[];
  readonly bullets?: readonly string[];
  readonly table?: Table;
}

export interface ReportDocument {
  readonly kind: ReportKind;
  readonly title: string;
  readonly subtitle: string;
  readonly organization: string;
  readonly generatedAt: string;
  readonly sections: readonly Section[];
  readonly assumptions: readonly string[];
}

const BAND_ORDER = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'] as const;

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

async function buildRiskReport(org: OrganizationRow): Promise<ReportDocument> {
  const { findings, prioritized, graph } = await assessOrganization(org.id);
  const tiers = groupByTier(prioritized);

  const counts = Object.fromEntries(
    BAND_ORDER.map((band) => [band, findings.filter((f) => f.risk.band === band).length]),
  ) as Record<(typeof BAND_ORDER)[number], number>;

  const sections: Section[] = [
    {
      heading: 'Summary',
      paragraphs: [
        `This assessment covers ${plural(graph.entities.length, 'recorded item')} and ` +
          `${plural(graph.dependencies.length, 'dependency', 'dependencies')}. It identifies ` +
          `${plural(findings.length, 'weakness', 'weaknesses')}: ${counts.CRITICAL} critical, ` +
          `${counts.HIGH} high, ${counts.MODERATE} moderate and ${counts.LOW} low.`,
        tiers.FIX_FIRST.length === 0
          ? 'Nothing currently warrants immediate action.'
          : `The ${plural(tiers.FIX_FIRST.length, 'item')} under "Fix first" below represent the ` +
            'highest-value work available: they combine severity, business reach and a fix that ' +
            'is achievable at reasonable cost.',
      ],
    },
  ];

  const tierLabels: Record<'FIX_FIRST' | 'FIX_NEXT' | 'MONITOR', string> = {
    FIX_FIRST: 'Fix first',
    FIX_NEXT: 'Fix next',
    MONITOR: 'Monitor',
  };

  for (const tier of ['FIX_FIRST', 'FIX_NEXT', 'MONITOR'] as const) {
    const items = tiers[tier];
    if (items.length === 0) continue;
    sections.push({
      heading: tierLabels[tier],
      table: {
        columns: ['Risk', 'Subject', 'Finding', 'Critical functions affected'],
        rows: items.map((item) => [
          item.finding.risk.band,
          item.finding.subjectName,
          item.finding.summary,
          String(item.finding.criticalDependentIds.length),
        ]),
      },
    });
  }

  // The top few weaknesses get their full reasoning, so a reader can challenge
  // the conclusion rather than only accept or reject it.
  const detailed = tiers.FIX_FIRST.slice(0, 3);
  if (detailed.length > 0) {
    sections.push({
      heading: 'Why these are rated as they are',
      paragraphs: detailed.flatMap((item) => [
        `${item.finding.subjectName} — ${item.finding.risk.band} ` +
          `(${item.finding.risk.score} of ${item.finding.risk.maxScore} points)`,
        ...item.finding.risk.reasons.map(
          (reason) =>
            `    ${reason.contribution >= 0 ? '+' : ''}${reason.contribution}  ${reason.statement} [${reason.confidence.toLowerCase()}]`,
        ),
      ]),
    });
  }

  return {
    kind: 'risk',
    title: 'Risk assessment',
    subtitle: `${plural(findings.length, 'weakness', 'weaknesses')} across ${plural(graph.entities.length, 'recorded item')}`,
    organization: org.name,
    generatedAt: new Date().toISOString(),
    sections,
    assumptions: [
      'Only dependencies recorded in C.O.R.E. are considered. Anything the organization has not written down cannot appear here.',
      'Risk is expressed as a band, not a probability. There is no calibrated likelihood model behind these figures.',
      'Where an item has no criticality of its own, it inherits the highest criticality among the things that depend on it.',
    ],
  };
}

async function buildReadinessReport(org: OrganizationRow): Promise<ReportDocument> {
  const graph = await loadOrganizationGraph(org.id);
  const assessments = assessOrganizationReadiness(graph);
  const nameByRef = new Map(graph.entities.map((entity) => [entity.id, entity.name]));

  const counts = { READY: 0, PARTIAL: 0, AT_RISK: 0, CRITICAL: 0 };
  for (const item of assessments) counts[item.state] += 1;

  const unknownTotal = assessments.reduce((sum, item) => sum + item.unknownCount, 0);

  return {
    kind: 'readiness',
    title: 'Continuity readiness',
    subtitle: `${plural(assessments.length, 'item')} assessed`,
    organization: org.name,
    generatedAt: new Date().toISOString(),
    sections: [
      {
        heading: 'Summary',
        paragraphs: [
          `Of ${plural(assessments.length, 'assessed item')}, ${counts.READY} are ready, ` +
            `${counts.PARTIAL} partly ready, ${counts.AT_RISK} at risk and ${counts.CRITICAL} critical.`,
          unknownTotal === 0
            ? 'Every applicable readiness question has a recorded answer.'
            : `${plural(unknownTotal, 'readiness question')} across the organization have no recorded ` +
              'answer. These are counted as unknown, never as satisfied — an unanswered question is a ' +
              'different problem from a failed one, and usually a cheaper one to fix.',
        ],
      },
      {
        heading: 'By item',
        table: {
          columns: ['State', 'Item', 'Checks passed', 'Unknown', 'Not met'],
          rows: assessments.map((item) => [
            item.state.replace(/_/g, ' '),
            nameByRef.get(item.subjectId) ?? item.subjectId,
            `${item.passedCount} of ${item.applicableCount}`,
            String(item.unknownCount),
            item.checks
              .filter((check) => !check.passed && !check.unknown)
              .map((check) => check.label)
              .join('; ') || '—',
          ]),
        },
      },
    ],
    assumptions: [
      'Readiness reflects what has been recorded, not what people believe to be true.',
      'A check with no recorded answer is reported as unknown and never counted as passing.',
      'Recovery is treated as unproven if it has not been tested within the last 365 days.',
    ],
  };
}

async function buildDependencyReport(org: OrganizationRow): Promise<ReportDocument> {
  const { findings, index } = await assessOrganization(org.id);

  const concentrations = findings.filter((finding: Finding) =>
    finding.kind.startsWith('single_'),
  );

  return {
    kind: 'dependencies',
    title: 'Critical dependencies',
    subtitle: `${plural(concentrations.length, 'concentration')} where one thing carries others`,
    organization: org.name,
    generatedAt: new Date().toISOString(),
    sections: [
      {
        heading: 'Summary',
        paragraphs: [
          concentrations.length === 0
            ? 'No single point of failure was found: everything recorded either has an alternative, or nothing depends on it.'
            : `${plural(concentrations.length, 'item')} would stop other work if they became ` +
              'unavailable, and have no recorded alternative. They are listed worst first.',
        ],
      },
      {
        heading: 'Concentrations',
        table: {
          columns: ['Risk', 'Item', 'Type', 'Things that stop', 'Critical functions'],
          rows: concentrations.map((finding) => [
            finding.risk.band,
            finding.subjectName,
            finding.kind.replace(/^single_/, '').replace(/_/g, ' '),
            String(finding.dependentIds.length),
            finding.criticalDependentIds
              .map((ref) => index.entityById.get(ref)?.name ?? ref)
              .join('; ') || '—',
          ]),
        },
      },
    ],
    assumptions: [
      'A concentration is reported only when losing the item would actually stop something else, using the same propagation model as the scenario tool.',
      'Items with a recorded and available alternative are not reported here, even if many things depend on them.',
    ],
  };
}

async function buildImprovementReport(org: OrganizationRow): Promise<ReportDocument> {
  const rows = await getDb()
    .select()
    .from(improvements)
    .where(eq(improvements.orgId, org.id))
    .orderBy(desc(improvements.createdAt));

  const open = rows.filter((row) => row.status !== 'COMPLETED' && row.status !== 'DECLINED');

  return {
    kind: 'improvements',
    title: 'Improvement plan',
    subtitle: `${plural(open.length, 'open improvement')}`,
    organization: org.name,
    generatedAt: new Date().toISOString(),
    sections: [
      {
        heading: 'Summary',
        paragraphs: [
          rows.length === 0
            ? 'No improvements have been recorded yet.'
            : `${plural(rows.length, 'improvement')} recorded, of which ${open.length} are open.`,
        ],
      },
      {
        heading: 'Register',
        table: {
          columns: ['Priority', 'Status', 'Improvement', 'Expected benefit', 'Verified by'],
          rows: rows.map((row) => [
            row.priority,
            row.status.replace(/_/g, ' '),
            row.title,
            row.expectedBenefit ?? '—',
            row.verification ?? '—',
          ]),
        },
      },
    ],
    assumptions: [
      'Improvements reduce the chance of recurrence. They are tracked separately from actions, which close a specific weakness now.',
    ],
  };
}

async function buildExerciseReport(org: OrganizationRow, id: string): Promise<ReportDocument> {
  const rows = await getDb()
    .select()
    .from(exercises)
    .where(and(eq(exercises.orgId, org.id), eq(exercises.id, id)))
    .limit(1);
  const exercise = rows[0];
  if (exercise === undefined) throw notFound('No such exercise in this organization.');

  const review = exercise.review as
    | {
        summary: string;
        whatWorked: string[];
        whatDidNot: string[];
        surprises: string[];
        missing: string[];
        timing: { expectedMinutes: number | null; actualMinutes: number | null; metTarget: boolean | null };
        recommendedImprovements: { title: string; expectedBenefit: string; priority: string }[];
        assumptions: string[];
      }
    | null;

  const timeline = await getDb()
    .select()
    .from(exerciseEvents)
    .where(eq(exerciseEvents.exerciseId, exercise.id))
    .orderBy(exerciseEvents.occurredAt);

  const sections: Section[] = [
    {
      heading: 'Summary',
      paragraphs: [
        review?.summary ?? 'This exercise has not been completed, so there is no review yet.',
        `Scenario: ${exercise.scenarioRefs.join(', ')}.`,
      ],
    },
  ];

  if (review !== null) {
    sections.push({
      heading: 'Timing',
      table: {
        columns: ['Expected recovery', 'Actual recovery', 'Met objective'],
        rows: [
          [
            review.timing.expectedMinutes === null ? 'not set' : `${review.timing.expectedMinutes} min`,
            review.timing.actualMinutes === null ? 'not recorded' : `${review.timing.actualMinutes} min`,
            review.timing.metTarget === null ? 'could not assess' : review.timing.metTarget ? 'yes' : 'no',
          ],
        ],
      },
    });

    if (review.whatWorked.length > 0) {
      sections.push({ heading: 'What worked', bullets: review.whatWorked });
    }
    if (review.whatDidNot.length > 0) {
      sections.push({ heading: 'What did not', bullets: review.whatDidNot });
    }
    if (review.surprises.length > 0) {
      sections.push({ heading: 'What surprised us', bullets: review.surprises });
    }
    if (review.missing.length > 0) {
      sections.push({ heading: 'What was missing', bullets: review.missing });
    }
    if (review.recommendedImprovements.length > 0) {
      sections.push({
        heading: 'Recommended improvements',
        table: {
          columns: ['Priority', 'Improvement', 'Expected benefit'],
          rows: review.recommendedImprovements.map((item) => [
            item.priority,
            item.title,
            item.expectedBenefit,
          ]),
        },
      });
    }
  }

  if (timeline.length > 0) {
    sections.push({
      heading: 'What happened',
      table: {
        columns: ['When', 'Type', 'Event'],
        rows: timeline.map((event) => [
          event.occurredAt.toISOString(),
          event.kind,
          event.description,
        ]),
      },
    });
  }

  return {
    kind: 'exercise',
    title: `After-action review — ${exercise.title}`,
    subtitle: exercise.reference,
    organization: org.name,
    generatedAt: new Date().toISOString(),
    sections,
    assumptions: review?.assumptions ?? [
      'The exercise has not been completed, so no comparison of expected against actual is available.',
    ],
  };
}

async function buildIncidentReport(org: OrganizationRow, id: string): Promise<ReportDocument> {
  const rows = await getDb()
    .select()
    .from(incidents)
    .where(and(eq(incidents.orgId, org.id), eq(incidents.id, id)))
    .limit(1);
  const incident = rows[0];
  if (incident === undefined) throw notFound('No such incident in this organization.');

  const events = await getDb()
    .select()
    .from(incidentEvents)
    .where(eq(incidentEvents.incidentId, incident.id))
    .orderBy(incidentEvents.occurredAt);

  const durationMinutes =
    incident.resolvedAt === null
      ? null
      : Math.round((incident.resolvedAt.getTime() - incident.startedAt.getTime()) / 60_000);

  return {
    kind: 'incident',
    title: `Incident review — ${incident.title}`,
    subtitle: `${incident.reference} · ${incident.severity}`,
    organization: org.name,
    generatedAt: new Date().toISOString(),
    sections: [
      {
        heading: 'Summary',
        paragraphs: [
          incident.description ?? 'No description was recorded.',
          `Started ${incident.startedAt.toISOString()}.` +
            (incident.resolvedAt === null
              ? ' Not yet resolved.'
              : ` Resolved ${incident.resolvedAt.toISOString()}, lasting ${durationMinutes} minutes.`),
          `Current status: ${incident.status.toLowerCase()}.`,
        ],
      },
      {
        heading: 'Timeline',
        table: {
          columns: ['When', 'Type', 'What happened'],
          rows: events.map((event) => [
            event.occurredAt.toISOString(),
            event.kind,
            event.description,
          ]),
        },
      },
    ],
    assumptions: [
      'The timeline records when events actually happened, which may differ from when they were entered.',
      'Only events participants recorded appear here.',
    ],
  };
}

// ---------------------------------------------------------------------------

export async function buildReport(
  org: OrganizationRow,
  kind: ReportKind,
  subjectId?: string,
): Promise<ReportDocument> {
  switch (kind) {
    case 'risk':
      return buildRiskReport(org);
    case 'readiness':
      return buildReadinessReport(org);
    case 'dependencies':
      return buildDependencyReport(org);
    case 'improvements':
      return buildImprovementReport(org);
    case 'exercise':
      if (subjectId === undefined) throw notFound('An exercise report needs an exercise.');
      return buildExerciseReport(org, subjectId);
    case 'incident':
      if (subjectId === undefined) throw notFound('An incident report needs an incident.');
      return buildIncidentReport(org, subjectId);
  }
}

/** Entities are re-exported for the CSV renderer's escaping tests. */
export function toCsv(document: ReportDocument): string {
  const escape = (value: string): string =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const lines: string[] = [];
  lines.push(escape(document.title));
  lines.push(escape(`${document.organization} — generated ${document.generatedAt}`));
  lines.push('');

  for (const section of document.sections) {
    lines.push(escape(section.heading));
    for (const paragraph of section.paragraphs ?? []) lines.push(escape(paragraph));
    for (const bullet of section.bullets ?? []) lines.push(escape(`- ${bullet}`));
    if (section.table !== undefined) {
      lines.push(section.table.columns.map(escape).join(','));
      for (const row of section.table.rows) lines.push(row.map(escape).join(','));
    }
    lines.push('');
  }

  if (document.assumptions.length > 0) {
    lines.push(escape('Assumptions'));
    for (const assumption of document.assumptions) lines.push(escape(`- ${assumption}`));
  }

  return lines.join('\r\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A self-contained, print-ready HTML document.
 *
 * No external stylesheet or font, so the file works from a mail attachment or a
 * filesystem with no network.
 */
export function toHtml(document: ReportDocument): string {
  const body = document.sections
    .map((section) => {
      const parts = [`<section><h2>${escapeHtml(section.heading)}</h2>`];
      for (const paragraph of section.paragraphs ?? []) {
        parts.push(`<p>${escapeHtml(paragraph)}</p>`);
      }
      if ((section.bullets ?? []).length > 0) {
        parts.push(
          `<ul>${(section.bullets ?? []).map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`,
        );
      }
      if (section.table !== undefined) {
        parts.push(
          '<table><thead><tr>' +
            section.table.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('') +
            '</tr></thead><tbody>' +
            section.table.rows
              .map(
                (row) => '<tr>' + row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('') + '</tr>',
              )
              .join('') +
            '</tbody></table>',
        );
      }
      parts.push('</section>');
      return parts.join('');
    })
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(document.title)} — ${escapeHtml(document.organization)}</title>
<style>
  @page { margin: 20mm; }
  * { box-sizing: border-box; }
  body { margin: 0 auto; padding: 32px; max-width: 62rem; background: #fbfaf8; color: #17191d;
    font: 15px/1.55 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
  h1, h2 { font-family: 'Iowan Old Style', Palatino, Georgia, serif; font-weight: 600; line-height: 1.2; }
  h1 { font-size: 2rem; margin: 0; }
  h2 { font-size: 1.3rem; margin: 2.2rem 0 0.6rem; padding-bottom: 0.4rem; border-bottom: 1px solid #e4e1db; }
  .meta { color: #4a4f57; margin-top: 0.4rem; }
  .rule { height: 3px; background: #2e5e4e; width: 3rem; margin: 1.2rem 0 0; }
  p { margin: 0.6rem 0; }
  ul { margin: 0.6rem 0; padding-left: 1.2rem; }
  li { margin: 0.25rem 0; }
  table { width: 100%; border-collapse: collapse; margin: 0.8rem 0; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.5rem 0.7rem; border-bottom: 1px solid #e4e1db; vertical-align: top; }
  th { background: #f4f2ee; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #4a4f57; }
  .assumptions { margin-top: 2.5rem; padding: 1rem 1.2rem; background: #f4f2ee;
    border: 1px solid #e4e1db; border-radius: 8px; font-size: 0.88rem; color: #4a4f57; }
  footer { margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid #e4e1db;
    font-size: 0.8rem; color: #7a818b; }
  @media print { body { background: #fff; padding: 0; } section { break-inside: avoid; } }
</style></head><body>
<header>
  <h1>${escapeHtml(document.title)}</h1>
  <div class="rule"></div>
  <p class="meta">${escapeHtml(document.organization)} · ${escapeHtml(document.subtitle)}<br>
  Generated ${escapeHtml(new Date(document.generatedAt).toUTCString())}</p>
</header>
${body}
${
  document.assumptions.length > 0
    ? `<div class="assumptions"><strong>Assumptions and limits</strong><ul>${document.assumptions
        .map((a) => `<li>${escapeHtml(a)}</li>`)
        .join('')}</ul></div>`
    : ''
}
<footer>C.O.R.E. — Continuity, Operations, Risk &amp; Execution. Generated from recorded organization data.</footer>
</body></html>`;
}

/** Persist a generated report so it can be reopened exactly as issued. */
export async function storeReport(
  orgId: string,
  document: ReportDocument,
  generatedBy: string,
): Promise<string> {
  const { reports } = await import('../db/schema.js');
  const [row] = await getDb()
    .insert(reports)
    .values({
      orgId,
      kind: document.kind,
      title: document.title,
      payload: document,
      generatedBy,
    })
    .returning({ id: reports.id });
  return row?.id ?? '';
}

/** Names used when a report is downloaded. */
export function fileNameFor(document: ReportDocument, extension: string): string {
  const slug = document.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const date = document.generatedAt.slice(0, 10);
  return `core-${slug}-${date}.${extension}`;
}
