#!/usr/bin/env node
/**
 * The C.O.R.E. command line.
 *
 * Every command calls the same services the HTTP API calls, so a CLI answer and
 * a browser answer cannot diverge. It connects straight to the database and is
 * therefore an operator's tool, not an end-user one: there is no session here,
 * and anyone who can run it already has the connection string.
 *
 * Output is plain text by default and JSON on request, so it composes with
 * other tools rather than only being read by a person.
 */

import { validateGraph } from '@core/engine';
import { closeDb, getDb } from '@core/api/db/client';
import { runMigrations } from '@core/api/db/migrate';
import { memberships, organizations, users } from '@core/api/db/schema';
import {
  assessOrganization,
  loadOrganizationGraph,
  readinessFor,
  runOrganizationScenario,
  solutionsForFinding,
} from '@core/api/services/orgGraph';
import { buildReport, toCsv, toHtml, type ReportKind } from '@core/api/services/reports';
import { renderPdf } from '@core/api/services/reportPdf';
import { demoDependencies, demoEntities, DEMO_ORG_NAME } from '@core/api/services/demo';
import { seedModel } from '@core/api/services/seed';
import { Command } from 'commander';
import { eq } from 'drizzle-orm';
import { writeFile } from 'node:fs/promises';

const program = new Command();

program
  .name('core')
  .description('C.O.R.E. — Continuity, Operations, Risk & Execution')
  .version('0.1.0');

/**
 * Wraps a command so the pool is always closed and failures exit non-zero.
 *
 * Generic over the action's arguments, because commander passes the command's
 * own operands and options through to it.
 */
function run<Args extends unknown[]>(
  work: (...args: Args) => Promise<void>,
): (...args: Args) => Promise<void> {
  return async (...args: Args) => {
    try {
      await work(...args);
    } catch (error) {
      console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
      await closeDb();
      process.exitCode = 1;
      return;
    }
    await closeDb();
  };
}

/** Resolve an organization by id or by a unique name fragment. */
async function findOrg(needle: string) {
  const rows = await getDb().select().from(organizations);
  const byId = rows.find((row) => row.id === needle);
  if (byId !== undefined) return byId;

  const matches = rows.filter((row) =>
    row.name.toLowerCase().includes(needle.toLowerCase()),
  );
  if (matches.length === 1 && matches[0] !== undefined) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `"${needle}" matches ${matches.length} organizations: ${matches.map((m) => m.name).join(', ')}. Use the id.`,
    );
  }
  throw new Error(`No organization matches "${needle}".`);
}

const BAND_MARK: Record<string, string> = {
  CRITICAL: '!!',
  HIGH: '! ',
  MODERATE: '~ ',
  LOW: '. ',
};

// ---------------------------------------------------------------------------

program
  .command('migrate')
  .description('apply any pending database migrations')
  .action(
    run(async () => {
      const outcome = await runMigrations();
      for (const name of outcome.applied) console.log(`  applied  ${name}`);
      for (const name of outcome.skipped) console.log(`  current  ${name}`);
      console.log(
        outcome.applied.length === 0
          ? '\n  Database is already up to date.\n'
          : `\n  Applied ${outcome.applied.length} migration(s).\n`,
      );
    }),
  );

program
  .command('orgs')
  .description('list organizations and their members')
  .action(
    run(async () => {
      const rows = await getDb()
        .select({ org: organizations, member: users, role: memberships.role })
        .from(organizations)
        .leftJoin(memberships, eq(memberships.orgId, organizations.id))
        .leftJoin(users, eq(memberships.userId, users.id));

      if (rows.length === 0) {
        console.log('\n  No organizations yet.\n');
        return;
      }

      const grouped = new Map<string, { name: string; demo: boolean; people: string[] }>();
      for (const row of rows) {
        const entry = grouped.get(row.org.id) ?? {
          name: row.org.name,
          demo: row.org.isDemo,
          people: [],
        };
        if (row.member !== null) entry.people.push(`${row.member.email} (${row.role})`);
        grouped.set(row.org.id, entry);
      }

      console.log('');
      for (const [id, entry] of grouped) {
        console.log(`  ${entry.name}${entry.demo ? '  [demo]' : ''}`);
        console.log(`    ${id}`);
        for (const person of entry.people) console.log(`    - ${person}`);
        console.log('');
      }
    }),
  );

program
  .command('validate <org>')
  .description('report structural problems in the organization model')
  .action(
    run(async (needle: string) => {
      const org = await findOrg(needle);
      const graph = await loadOrganizationGraph(org.id);
      const issues = validateGraph(graph);

      console.log(`\n  ${org.name} — ${graph.entities.length} items, ${graph.dependencies.length} dependencies\n`);
      if (issues.length === 0) {
        console.log('  No structural problems found.\n');
        return;
      }
      for (const issue of issues) {
        console.log(`  ${issue.severity === 'error' ? 'ERROR  ' : 'warning'}  ${issue.message}`);
      }
      console.log('');
      if (issues.some((issue) => issue.severity === 'error')) process.exitCode = 1;
    }),
  );

program
  .command('assess <org>')
  .description('assess the organization and list weaknesses worst first')
  .option('--json', 'emit JSON instead of text')
  .option('--tier <tier>', 'only FIX_FIRST, FIX_NEXT or MONITOR')
  .action(
    run(async (needle: string, options: { json?: boolean; tier?: string }) => {
      const org = await findOrg(needle);
      const { findings, prioritized } = await assessOrganization(org.id);

      const wantedTier = options.tier?.toUpperCase();
      const selected =
        wantedTier === undefined
          ? prioritized
          : prioritized.filter((item) => item.tier === wantedTier);

      if (options.json === true) {
        console.log(JSON.stringify(selected, null, 2));
        return;
      }

      console.log(`\n  ${org.name} — ${findings.length} weakness(es)\n`);
      let currentTier = '';
      for (const item of selected) {
        if (item.tier !== currentTier) {
          currentTier = item.tier;
          console.log(`  ${currentTier.replace(/_/g, ' ')}`);
          console.log(`  ${'-'.repeat(currentTier.length)}`);
        }
        console.log(`  ${BAND_MARK[item.finding.risk.band] ?? '  '} ${item.finding.subjectName}`);
        console.log(`       ${item.finding.summary}`);
      }
      console.log('');
    }),
  );

program
  .command('readiness <org>')
  .description('report readiness, worst first')
  .option('--json', 'emit JSON instead of text')
  .action(
    run(async (needle: string, options: { json?: boolean }) => {
      const org = await findOrg(needle);
      const assessments = await readinessFor(org.id);

      if (options.json === true) {
        console.log(JSON.stringify(assessments, null, 2));
        return;
      }

      console.log(`\n  ${org.name} — readiness\n`);
      for (const item of assessments) {
        console.log(
          `  ${item.state.padEnd(9)}  ${item.subjectName}  (${item.passedCount}/${item.applicableCount}` +
            `${item.unknownCount > 0 ? `, ${item.unknownCount} unknown` : ''})`,
        );
      }
      console.log('');
    }),
  );

program
  .command('scenario <org> <refs...>')
  .description('ask what happens if the named things become unavailable')
  .option('--json', 'emit JSON instead of text')
  .action(
    run(async (needle: string, refs: string[], options: { json?: boolean }) => {
      const org = await findOrg(needle);
      const result = await runOrganizationScenario(org.id, refs, `CLI: ${refs.join(', ')}`);

      if (options.json === true) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`\n  ${org.name} — what happens if ${refs.join(', ')} fails\n`);
      for (const [index, wave] of result.waves.entries()) {
        console.log(`  ${index === 0 ? 'You removed' : `Breaks step ${index}`}:`);
        for (const item of wave) {
          console.log(`    ${item.state.padEnd(9)} ${item.name}`);
        }
      }
      console.log(
        `\n  Business functions stopped: ${
          result.failedFunctions.map((f) => f.name).join(', ') || 'none'
        }`,
      );
      console.log(`  Fallbacks that held: ${result.fallbacksUsed.length}`);
      console.log(`  Places with no alternative: ${result.missingFallbacks.length}\n`);
      for (const assumption of result.assumptions) console.log(`  · ${assumption}`);
      console.log('');
    }),
  );

program
  .command('solve <org> <finding>')
  .description('show the options for one finding, e.g. single_person:p-priya')
  .option('--json', 'emit JSON instead of text')
  .action(
    run(async (needle: string, findingId: string, options: { json?: boolean }) => {
      const org = await findOrg(needle);
      const { solutions } = await solutionsForFinding(org.id, findingId);

      if (options.json === true) {
        console.log(JSON.stringify(solutions, null, 2));
        return;
      }

      console.log(`\n  ${solutions.problem}\n`);
      console.log(`  ${solutions.whyItMatters}\n`);
      for (const option of solutions.options) {
        const recommended = option.id === solutions.recommendedOptionId;
        console.log(`  ${recommended ? '>' : ' '} ${option.title}${recommended ? '   [recommended]' : ''}`);
        console.log(
          `      removes ${option.riskReduction}/3 · cost ${option.tradeOffs.cost.toLowerCase()}` +
            ` · effort ${option.tradeOffs.effort.toLowerCase()}`,
        );
      }
      console.log(`\n  Why: ${solutions.recommendationRationale}\n`);
    }),
  );

program
  .command('report <org> <kind>')
  .description('generate a report: risk, readiness, dependencies or improvements')
  .option('-f, --format <format>', 'json, csv, html or pdf', 'html')
  .option('-o, --out <file>', 'write to a file instead of stdout')
  .action(
    run(async (needle: string, kind: string, options: { format: string; out?: string }) => {
      const org = await findOrg(needle);
      const document = await buildReport(org, kind as ReportKind);

      let output: string | Buffer;
      switch (options.format) {
        case 'json':
          output = JSON.stringify(document, null, 2);
          break;
        case 'csv':
          output = toCsv(document);
          break;
        case 'pdf':
          output = await renderPdf(document);
          break;
        default:
          output = toHtml(document);
      }

      if (options.out === undefined) {
        if (options.format === 'pdf') {
          throw new Error('A PDF cannot be written to the terminal. Use --out to name a file.');
        }
        console.log(typeof output === 'string' ? output : output.toString('utf8'));
        return;
      }

      await writeFile(options.out, output);
      const size = typeof output === 'string' ? Buffer.byteLength(output) : output.length;
      console.log(`\n  Wrote ${options.out} (${size} bytes)\n`);
    }),
  );

program
  .command('seed-demo <email>')
  .description('create the labelled demo organization for an existing account')
  .action(
    run(async (email: string) => {
      const db = getDb();
      const found = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
      const user = found[0];
      if (user === undefined) throw new Error(`No account for ${email}. Create it in the app first.`);

      const created = await db.transaction(async (tx) => {
        const [org] = await tx
          .insert(organizations)
          .values({ name: DEMO_ORG_NAME, isDemo: true, timezone: 'Europe/London' })
          .returning();
        if (org === undefined) throw new Error('organization insert returned nothing');
        await tx.insert(memberships).values({ orgId: org.id, userId: user.id, role: 'ADMIN' });
        const summary = await seedModel(tx, org.id, demoEntities, demoDependencies);
        return { org, summary };
      });

      console.log(
        `\n  Created "${created.org.name}" for ${email}\n` +
          `  ${created.summary.entitiesCreated} items, ${created.summary.dependenciesCreated} dependencies\n` +
          `  ${created.org.id}\n`,
      );
    }),
  );

await program.parseAsync(process.argv);
