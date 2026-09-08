/**
 * The organization model.
 *
 * Everything C.O.R.E. concludes comes from what is recorded here, so this is
 * where a real organization gets built: the things it depends on, and how they
 * connect. Without it the product can only ever analyse the demo.
 *
 * The page is arranged as three tasks rather than three tables — add what you
 * depend on, say how it connects, or bring it in from a file — because that is
 * the order someone actually works in.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { Empty, ErrorState, Eyebrow, Loading } from '../components/Bits';
import { api, ApiError } from '../lib/api';

const KINDS = [
  'business_function',
  'process',
  'application',
  'service',
  'vendor',
  'team',
  'person',
  'location',
  'facility',
  'data_asset',
] as const;

const DEPENDENCY_TYPES = [
  'requires',
  'operates',
  'hosts',
  'supplies',
  'staffs',
  'stores',
  'authenticates',
] as const;

interface Entity {
  ref: string;
  kind: string;
  name: string;
  description: string | null;
  criticality: string | null;
  ownerRef: string | null;
  alternateRefs: string[];
  procedureDocumented: boolean | null;
  lastTestedAt: string | null;
  mtdMinutes: number | null;
  rtoMinutes: number | null;
}

interface Dependency {
  ref: string;
  dependentRef: string;
  providerRef: string;
  type: string;
  optional: boolean;
  fallbackProviderRefs: string[];
}

interface QualityIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  subjectId: string;
}

type Tab = 'items' | 'dependencies' | 'import';

/** Derives a stable, readable ref from a name, e.g. "Pay staff" -> "bf-pay-staff". */
function suggestRef(kind: string, name: string, taken: ReadonlySet<string>): string {
  const prefix =
    { business_function: 'bf', person: 'p', team: 'team', vendor: 'vendor', location: 'loc' }[
      kind
    ] ?? kind.slice(0, 4);
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  let candidate = `${prefix}-${base || 'item'}`;
  let suffix = 2;
  while (taken.has(candidate)) candidate = `${prefix}-${base || 'item'}-${suffix++}`;
  return candidate;
}

export function ModelPage(): ReactNode {
  const { orgId } = useParams<{ orgId: string }>();
  const [entities, setEntities] = useState<Entity[] | null>(null);
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [issues, setIssues] = useState<QualityIssue[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [tab, setTab] = useState<Tab>('items');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (orgId === undefined) return;
    try {
      const [e, d, q] = await Promise.all([
        api.get<{ entities: Entity[] }>(`/api/v1/model/${orgId}/entities`),
        api.get<{ dependencies: Dependency[] }>(`/api/v1/model/${orgId}/dependencies`),
        api.get<{ issues: QualityIssue[] }>(`/api/v1/model/${orgId}/quality`),
      ]);
      setEntities(e.entities);
      setDependencies(d.dependencies);
      setIssues(q.issues);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : null);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (work: () => Promise<unknown>) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await work();
        await load();
      } catch (caught) {
        setError(caught instanceof ApiError ? caught : null);
      } finally {
        setBusy(false);
      }
    },
    [busy, load],
  );

  const takenRefs = useMemo(
    () => new Set((entities ?? []).map((entity) => entity.ref)),
    [entities],
  );

  if (error !== null && entities === null) {
    return <ErrorState title="Could not load the model" message={error.message} requestId={error.requestId} />;
  }
  if (entities === null) return <Loading what="your organization model" />;

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  return (
    <div className="stack-lg">
      <header className="page-head">
        <h1 style={{ fontSize: 'var(--step-3)' }}>Organization model</h1>
        <p className="lede">
          Everything C.O.R.E. concludes comes from what is recorded here. Add the things you depend
          on, then say how they connect — the analysis follows from that.
        </p>
      </header>

      {error !== null && (
        <div className="notice notice-error" role="alert">
          {error.message}
          {Object.entries(error.fieldErrors()).map(([field, messages]) => (
            <span key={field} style={{ display: 'block' }}>
              {field}: {messages.join(' ')}
            </span>
          ))}
        </div>
      )}

      <div className="counts">
        <div className="count">
          <div className="count-value">{entities.length}</div>
          <div className="count-label">Things recorded</div>
        </div>
        <div className="count">
          <div className="count-value">{dependencies.length}</div>
          <div className="count-label">Dependencies</div>
        </div>
        <div className="count">
          <div
            className="count-value"
            style={{ color: errors.length > 0 ? 'var(--band-critical)' : undefined }}
          >
            {errors.length}
          </div>
          <div className="count-label">Data errors</div>
        </div>
        <div className="count">
          <div
            className="count-value"
            style={{ color: warnings.length > 0 ? 'var(--band-high)' : undefined }}
          >
            {warnings.length}
          </div>
          <div className="count-label">Warnings</div>
        </div>
      </div>

      {issues.length > 0 && (
        <section className={errors.length > 0 ? 'notice notice-error' : 'notice notice-warn'}>
          <Eyebrow>Data quality</Eyebrow>
          <ul style={{ marginTop: 'var(--s-2)', paddingLeft: '1.1rem' }}>
            {issues.slice(0, 8).map((issue) => (
              <li key={issue.code + issue.subjectId}>{issue.message}</li>
            ))}
          </ul>
        </section>
      )}

      <nav className="row" aria-label="Model sections">
        {(
          [
            ['items', `Things (${entities.length})`],
            ['dependencies', `Dependencies (${dependencies.length})`],
            ['import', 'Import'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'items' && (
        <EntitySection
          orgId={orgId ?? ''}
          entities={entities}
          takenRefs={takenRefs}
          busy={busy}
          onAct={act}
        />
      )}

      {tab === 'dependencies' && (
        <DependencySection
          orgId={orgId ?? ''}
          entities={entities}
          dependencies={dependencies}
          busy={busy}
          onAct={act}
        />
      )}

      {tab === 'import' && <ImportSection orgId={orgId ?? ''} busy={busy} onAct={act} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function EntitySection({
  orgId,
  entities,
  takenRefs,
  busy,
  onAct,
}: {
  orgId: string;
  entities: Entity[];
  takenRefs: ReadonlySet<string>;
  busy: boolean;
  onAct: (work: () => Promise<unknown>) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<string>('business_function');
  const [criticality, setCriticality] = useState('');
  const [ownerRef, setOwnerRef] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const people = entities.filter((entity) => entity.kind === 'person');

  return (
    <div className="stack">
      <form
        className="card stack"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void onAct(async () => {
            await api.post(`/api/v1/model/${orgId}/entities`, {
              ref: suggestRef(kind, name, takenRefs),
              kind,
              name: name.trim(),
              ...(criticality === '' ? {} : { criticality }),
              ...(ownerRef === '' ? {} : { ownerRef }),
            });
            setName('');
            setCriticality('');
            setOwnerRef('');
          });
        }}
      >
        <Eyebrow>Add something you depend on</Eyebrow>
        <div className="row">
          <input
            className="plain-input"
            style={{ flex: '2 1 16rem' }}
            placeholder="Name, e.g. Pay staff, or Payroll system"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <select
            className="plain-input"
            style={{ width: 'auto' }}
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            {KINDS.map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <select
            className="plain-input"
            style={{ width: 'auto' }}
            value={criticality}
            onChange={(event) => setCriticality(event.target.value)}
          >
            <option value="">criticality — not set</option>
            {['CRITICAL', 'HIGH', 'MODERATE', 'LOW'].map((option) => (
              <option key={option} value={option}>
                {option.toLowerCase()}
              </option>
            ))}
          </select>
          {people.length > 0 && (
            <select
              className="plain-input"
              style={{ width: 'auto' }}
              value={ownerRef}
              onChange={(event) => setOwnerRef(event.target.value)}
            >
              <option value="">owner — not set</option>
              {people.map((person) => (
                <option key={person.ref} value={person.ref}>
                  {person.name}
                </option>
              ))}
            </select>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy || name.trim() === ''}>
            Add
          </button>
        </div>
        <p className="faint" style={{ fontSize: 'var(--step--1)' }}>
          Criticality is worth setting on business functions. Everything else inherits the highest
          criticality of whatever depends on it, so you do not have to set it everywhere.
        </p>
      </form>

      {entities.length === 0 ? (
        <Empty title="Nothing recorded yet.">
          <p className="muted">Start with what the organization actually does, then what it needs.</p>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Criticality</th>
                <th>Owner</th>
                <th>Resilience</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entities.map((entity) => (
                <tr key={entity.ref}>
                  <td>
                    <strong>{entity.name}</strong>
                    <span className="verify-note" style={{ display: 'block' }}>
                      {entity.ref}
                    </span>
                  </td>
                  <td>{entity.kind.replace(/_/g, ' ')}</td>
                  <td>
                    {entity.criticality === null ? (
                      <span className="faint">inherited</span>
                    ) : (
                      <span className={`band band-${entity.criticality}`}>{entity.criticality}</span>
                    )}
                  </td>
                  <td>{entity.ownerRef ?? <span className="faint">—</span>}</td>
                  <td>
                    <span className="verify-note">
                      {entity.procedureDocumented === true
                        ? 'procedure ✓'
                        : entity.procedureDocumented === false
                          ? 'no procedure'
                          : 'procedure unknown'}
                      {' · '}
                      {entity.lastTestedAt === null
                        ? 'never tested'
                        : `tested ${new Date(entity.lastTestedAt).toLocaleDateString()}`}
                      {entity.rtoMinutes !== null && ` · RTO ${entity.rtoMinutes}m`}
                    </span>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 'var(--s-2)' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-quiet"
                        onClick={() => setEditing(editing === entity.ref ? null : entity.ref)}
                      >
                        {editing === entity.ref ? 'Close' : 'Edit'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-quiet"
                        disabled={busy}
                        onClick={() =>
                          void onAct(() =>
                            api.del(`/api/v1/model/${orgId}/entities/${entity.ref}`),
                          )
                        }
                      >
                        Remove
                      </button>
                    </div>
                    {editing === entity.ref && (
                      <EntityEditor
                        orgId={orgId}
                        entity={entity}
                        entities={entities}
                        busy={busy}
                        onAct={onAct}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The resilience fields, which are what the risk and readiness engines read. */
function EntityEditor({
  orgId,
  entity,
  entities,
  busy,
  onAct,
}: {
  orgId: string;
  entity: Entity;
  entities: Entity[];
  busy: boolean;
  onAct: (work: () => Promise<unknown>) => Promise<void>;
}): ReactNode {
  const [procedure, setProcedure] = useState(
    entity.procedureDocumented === null ? '' : String(entity.procedureDocumented),
  );
  const [tested, setTested] = useState(entity.lastTestedAt?.slice(0, 10) ?? '');
  const [mtd, setMtd] = useState(entity.mtdMinutes === null ? '' : String(entity.mtdMinutes));
  const [rto, setRto] = useState(entity.rtoMinutes === null ? '' : String(entity.rtoMinutes));
  const [alternates, setAlternates] = useState<string[]>(entity.alternateRefs);

  return (
    <div className="card stack-sm" style={{ marginTop: 'var(--s-3)', minWidth: '22rem' }}>
      <Eyebrow>Resilience of {entity.name}</Eyebrow>

      <label className="field">
        <span>Is there a written procedure?</span>
        <select value={procedure} onChange={(event) => setProcedure(event.target.value)}>
          <option value="">nobody has recorded an answer</option>
          <option value="true">yes</option>
          <option value="false">no</option>
        </select>
      </label>

      <label className="field">
        <span>Recovery last proven</span>
        <input type="date" value={tested} onChange={(event) => setTested(event.target.value)} />
      </label>

      {entity.kind === 'business_function' && (
        <>
          <label className="field">
            <span>Tolerable downtime (minutes)</span>
            <input
              inputMode="numeric"
              value={mtd}
              onChange={(event) => setMtd(event.target.value.replace(/\D/g, ''))}
            />
          </label>
          <label className="field">
            <span>Recovery target (minutes)</span>
            <input
              inputMode="numeric"
              value={rto}
              onChange={(event) => setRto(event.target.value.replace(/\D/g, ''))}
            />
          </label>
        </>
      )}

      <label className="field">
        <span>What can stand in for this?</span>
        <select
          multiple
          size={4}
          value={alternates}
          onChange={(event) =>
            setAlternates([...event.target.selectedOptions].map((option) => option.value))
          }
        >
          {entities
            .filter((candidate) => candidate.ref !== entity.ref)
            .map((candidate) => (
              <option key={candidate.ref} value={candidate.ref}>
                {candidate.name}
              </option>
            ))}
        </select>
        <span className="hint">Hold Ctrl or Cmd to choose more than one.</span>
      </label>

      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={busy}
        onClick={() =>
          void onAct(() =>
            api.patch(`/api/v1/model/${orgId}/entities/${entity.ref}`, {
              procedureDocumented: procedure === '' ? undefined : procedure === 'true',
              ...(tested === '' ? {} : { lastTestedAt: new Date(tested).toISOString() }),
              ...(mtd === '' ? {} : { mtdMinutes: Number(mtd) }),
              ...(rto === '' ? {} : { rtoMinutes: Number(rto) }),
              alternateRefs: alternates,
            }),
          )
        }
      >
        Save
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DependencySection({
  orgId,
  entities,
  dependencies,
  busy,
  onAct,
}: {
  orgId: string;
  entities: Entity[];
  dependencies: Dependency[];
  busy: boolean;
  onAct: (work: () => Promise<unknown>) => Promise<void>;
}): ReactNode {
  const [dependentRef, setDependentRef] = useState('');
  const [providerRef, setProviderRef] = useState('');
  const [type, setType] = useState<string>('requires');
  const [optional, setOptional] = useState(false);
  const [fallbacks, setFallbacks] = useState<string[]>([]);

  const nameOf = (ref: string): string =>
    entities.find((entity) => entity.ref === ref)?.name ?? ref;

  if (entities.length < 2) {
    return (
      <Empty title="Add at least two things first.">
        <p className="muted">A dependency connects one thing to another.</p>
      </Empty>
    );
  }

  return (
    <div className="stack">
      <form
        className="card stack"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void onAct(async () => {
            await api.post(`/api/v1/model/${orgId}/dependencies`, {
              ref: `d-${dependentRef}-${providerRef}`.slice(0, 120),
              dependentRef,
              providerRef,
              type,
              optional,
              fallbackProviderRefs: fallbacks,
            });
            setFallbacks([]);
          });
        }}
      >
        <Eyebrow>Record a dependency</Eyebrow>
        <div className="row">
          <select
            className="plain-input"
            style={{ flex: '1 1 12rem' }}
            value={dependentRef}
            onChange={(event) => setDependentRef(event.target.value)}
            required
          >
            <option value="">this…</option>
            {entities.map((entity) => (
              <option key={entity.ref} value={entity.ref}>
                {entity.name}
              </option>
            ))}
          </select>

          <select
            className="plain-input"
            style={{ width: 'auto' }}
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            {DEPENDENCY_TYPES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <select
            className="plain-input"
            style={{ flex: '1 1 12rem' }}
            value={providerRef}
            onChange={(event) => setProviderRef(event.target.value)}
            required
          >
            <option value="">…this</option>
            {entities
              .filter((entity) => entity.ref !== dependentRef)
              .map((entity) => (
                <option key={entity.ref} value={entity.ref}>
                  {entity.name}
                </option>
              ))}
          </select>

          <label className="row" style={{ gap: 'var(--s-2)' }}>
            <input
              type="checkbox"
              checked={optional}
              onChange={(event) => setOptional(event.target.checked)}
            />
            <span style={{ fontSize: 'var(--step--1)' }}>can carry on without it</span>
          </label>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || dependentRef === '' || providerRef === ''}
          >
            Add
          </button>
        </div>

        {providerRef !== '' && (
          <label className="field">
            <span>If that becomes unavailable, what takes over?</span>
            <select
              multiple
              size={3}
              value={fallbacks}
              onChange={(event) =>
                setFallbacks([...event.target.selectedOptions].map((option) => option.value))
              }
            >
              {entities
                .filter((entity) => entity.ref !== providerRef && entity.ref !== dependentRef)
                .map((entity) => (
                  <option key={entity.ref} value={entity.ref}>
                    {entity.name}
                  </option>
                ))}
            </select>
            <span className="hint">
              A recorded fallback is the difference between something degrading and something
              stopping.
            </span>
          </label>
        )}
      </form>

      {dependencies.length === 0 ? (
        <Empty title="No dependencies recorded.">
          <p className="muted">
            Without these, C.O.R.E. cannot tell what would stop if something failed.
          </p>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>This</th>
                <th>Needs</th>
                <th>Falls back to</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dependencies.map((dependency) => (
                <tr key={dependency.ref}>
                  <td>
                    <strong>{nameOf(dependency.dependentRef)}</strong>
                    {dependency.optional && <span className="tag"> optional</span>}
                  </td>
                  <td>
                    {nameOf(dependency.providerRef)}
                    <span className="verify-note" style={{ display: 'block' }}>
                      {dependency.type}
                    </span>
                  </td>
                  <td>
                    {dependency.fallbackProviderRefs.length === 0 ? (
                      <span className="faint">nothing</span>
                    ) : (
                      dependency.fallbackProviderRefs.map(nameOf).join(', ')
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-sm btn-quiet"
                      disabled={busy}
                      onClick={() =>
                        void onAct(() =>
                          api.del(`/api/v1/model/${orgId}/dependencies/${dependency.ref}`),
                        )
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const IMPORT_EXAMPLE = `{
  "entities": [
    { "ref": "bf-payroll", "kind": "business_function", "name": "Pay staff",
      "criticality": "CRITICAL", "mtdMinutes": 2880, "rtoMinutes": 1440 },
    { "ref": "app-payroll", "kind": "application", "name": "Payroll system" }
  ],
  "dependencies": [
    { "ref": "d1", "dependentRef": "bf-payroll",
      "providerRef": "app-payroll", "type": "requires" }
  ]
}`;

function ImportSection({
  orgId,
  busy,
  onAct,
}: {
  orgId: string;
  busy: boolean;
  onAct: (work: () => Promise<unknown>) => Promise<void>;
}): ReactNode {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [summary, setSummary] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  return (
    <div className="stack">
      <div className="card stack">
        <Eyebrow>Import from a file</Eyebrow>
        <p className="muted" style={{ fontSize: 'var(--step--1)' }}>
          Paste JSON describing what you depend on. The import is all or nothing: if anything
          references something that is not in the file, nothing is created and you are told what
          went wrong.
        </p>

        <textarea
          className="plain-input"
          rows={12}
          spellCheck={false}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--step--1)' }}
          placeholder={IMPORT_EXAMPLE}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />

        <div className="row">
          <select
            className="plain-input"
            style={{ width: 'auto' }}
            value={mode}
            onChange={(event) => setMode(event.target.value as 'append' | 'replace')}
          >
            <option value="append">add to what is already here</option>
            <option value="replace">replace everything</option>
          </select>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || text.trim() === ''}
            onClick={() => {
              setParseError(null);
              setSummary(null);
              let payload: unknown;
              try {
                payload = JSON.parse(text);
              } catch (caught) {
                setParseError(
                  `That is not valid JSON: ${caught instanceof Error ? caught.message : 'unparseable'}`,
                );
                return;
              }
              void onAct(async () => {
                const result = await api.post<{
                  summary: {
                    read: number;
                    accepted: number;
                    rejected: number;
                    entitiesCreated: number;
                    dependenciesCreated: number;
                  };
                  warnings: string[];
                }>(`/api/v1/model/${orgId}/import`, {
                  ...(payload as object),
                  mode,
                });
                setSummary(
                  `Read ${result.summary.read}, created ${result.summary.entitiesCreated} item(s) ` +
                    `and ${result.summary.dependenciesCreated} dependency/dependencies, ` +
                    `rejected ${result.summary.rejected}.` +
                    (result.warnings.length > 0
                      ? ` ${result.warnings.length} thing(s) worth checking afterwards.`
                      : ''),
                );
                setText('');
              });
            }}
          >
            Import
          </button>
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => setText(IMPORT_EXAMPLE)}
          >
            Use the example
          </button>
        </div>

        {parseError !== null && (
          <p className="error" role="alert" style={{ color: 'var(--band-critical)' }}>
            {parseError}
          </p>
        )}
        {summary !== null && <p className="notice">{summary}</p>}
      </div>
    </div>
  );
}
