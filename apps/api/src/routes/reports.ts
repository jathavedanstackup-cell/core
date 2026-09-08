/**
 * Reports.
 *
 * Generating and downloading are separate steps. Generating stores the document
 * so a report handed to a board can be reopened exactly as issued rather than
 * quietly regenerated from newer data — which would make two people holding
 * "the same report" disagree.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { getDb } from '../db/client.js';
import { reports } from '../db/schema.js';
import { recordAudit } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import { noStore, requireOrg } from '../plugins/context.js';
import { renderPdf } from '../services/reportPdf.js';
import {
  buildReport,
  fileNameFor,
  storeReport,
  toCsv,
  toHtml,
  type ReportDocument,
  type ReportKind,
} from '../services/reports.js';

const orgParams = z.object({ orgId: z.string().uuid() });

const KINDS = [
  'risk',
  'readiness',
  'dependencies',
  'improvements',
  'exercise',
  'incident',
] as const;

const FORMATS = ['json', 'csv', 'html', 'pdf'] as const;
type Format = (typeof FORMATS)[number];

const CATALOGUE: { kind: ReportKind; title: string; description: string; needsSubject: boolean }[] =
  [
    {
      kind: 'risk',
      title: 'Risk assessment',
      description: 'Every weakness found, sorted into what to fix first, next, and simply watch.',
      needsSubject: false,
    },
    {
      kind: 'readiness',
      title: 'Continuity readiness',
      description: 'Whether the organization is actually prepared, check by check.',
      needsSubject: false,
    },
    {
      kind: 'dependencies',
      title: 'Critical dependencies',
      description: 'The things that would stop other work if they became unavailable.',
      needsSubject: false,
    },
    {
      kind: 'improvements',
      title: 'Improvement plan',
      description: 'The preventive improvement register and its current state.',
      needsSubject: false,
    },
    {
      kind: 'exercise',
      title: 'After-action review',
      description: 'What an exercise expected, what happened, and what to change.',
      needsSubject: true,
    },
    {
      kind: 'incident',
      title: 'Incident review',
      description: 'One incident with its full chronological timeline.',
      needsSubject: true,
    },
  ];

/** Renders a document in the requested format, with the right headers. */
async function send(
  reply: FastifyReply,
  document: ReportDocument,
  format: Format,
  download: boolean,
): Promise<unknown> {
  const disposition = (extension: string): void => {
    if (!download) return;
    void reply.header(
      'content-disposition',
      `attachment; filename="${fileNameFor(document, extension)}"`,
    );
  };

  switch (format) {
    case 'json':
      disposition('json');
      return document;
    case 'csv':
      void reply.type('text/csv; charset=utf-8');
      disposition('csv');
      return toCsv(document);
    case 'html':
      void reply.type('text/html; charset=utf-8');
      disposition('html');
      return toHtml(document);
    case 'pdf': {
      const buffer = await renderPdf(document);
      void reply.type('application/pdf');
      disposition('pdf');
      void reply.header('content-length', String(buffer.length));
      return reply.send(buffer);
    }
  }
}

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  // -------------------------------------------------------------------------
  app.get('/:orgId/catalogue', async (request) => {
    const { orgId } = orgParams.parse(request.params);
    await requireOrg(request, orgId);
    return { reports: CATALOGUE, formats: FORMATS };
  });

  // -------------------------------------------------------------------------
  app.get('/:orgId', async (request) => {
    const { orgId } = orgParams.parse(request.params);
    await requireOrg(request, orgId);

    const rows = await getDb()
      .select({
        id: reports.id,
        kind: reports.kind,
        title: reports.title,
        createdAt: reports.createdAt,
      })
      .from(reports)
      .where(eq(reports.orgId, orgId))
      .orderBy(desc(reports.createdAt))
      .limit(50);

    return {
      reports: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  });

  // -------------------------------------------------------------------------
  /**
   * Preview without storing. Useful for looking before committing a document
   * that other people may later be handed.
   */
  app.get('/:orgId/preview/:kind', async (request, reply) => {
    const params = orgParams.extend({ kind: z.enum(KINDS) }).parse(request.params);
    const query = z
      .object({
        format: z.enum(FORMATS).default('json'),
        subject: z.string().uuid().optional(),
        download: z.coerce.boolean().default(false),
      })
      .parse(request.query);

    const context = await requireOrg(request, params.orgId);
    noStore(reply);

    const document = await buildReport(context.org, params.kind, query.subject);
    return send(reply, document, query.format, query.download);
  });

  // -------------------------------------------------------------------------
  app.post('/:orgId/:kind', async (request, reply) => {
    const params = orgParams.extend({ kind: z.enum(KINDS) }).parse(request.params);
    const body = z
      .object({ subject: z.string().uuid().optional() })
      .parse(request.body ?? {});

    const context = await requireOrg(request, params.orgId, 'OPERATOR');

    const document = await buildReport(context.org, params.kind, body.subject);
    const id = await storeReport(params.orgId, document, context.user.id);

    await recordAudit({
      orgId: params.orgId,
      actorId: context.user.id,
      actorEmail: context.user.email,
      entityType: 'report',
      entityId: id,
      action: 'generate',
      after: { kind: params.kind, title: document.title },
      requestId: String(request.id),
    });

    void reply.status(201);
    return { report: { id, kind: document.kind, title: document.title }, document };
  });

  // -------------------------------------------------------------------------
  /** Download a stored report exactly as it was generated. */
  app.get('/:orgId/:reportId/download', async (request, reply) => {
    const params = orgParams.extend({ reportId: z.string().uuid() }).parse(request.params);
    const query = z.object({ format: z.enum(FORMATS).default('pdf') }).parse(request.query);

    await requireOrg(request, params.orgId);

    const rows = await getDb()
      .select()
      .from(reports)
      .where(and(eq(reports.orgId, params.orgId), eq(reports.id, params.reportId)))
      .limit(1);
    const row = rows[0];
    if (row === undefined) throw notFound('No such report in this organization.');

    return send(reply, row.payload as ReportDocument, query.format, true);
  });
}
