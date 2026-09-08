/**
 * Reports.
 *
 * Generating stores the document, so a report handed to a board can be reopened
 * exactly as issued. Previewing does not store anything, which is what you want
 * before committing a document other people will be given.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { Empty, ErrorState, Eyebrow, Loading } from '../components/Bits';
import { api, ApiError } from '../lib/api';

interface CatalogueEntry {
  kind: string;
  title: string;
  description: string;
  needsSubject: boolean;
}

interface StoredReport {
  id: string;
  kind: string;
  title: string;
  createdAt: string;
}

const FORMATS = [
  { id: 'pdf', label: 'PDF' },
  { id: 'html', label: 'HTML' },
  { id: 'csv', label: 'CSV' },
  { id: 'json', label: 'JSON' },
] as const;

export function ReportsPage(): ReactNode {
  const { orgId } = useParams<{ orgId: string }>();
  const [catalogue, setCatalogue] = useState<CatalogueEntry[] | null>(null);
  const [stored, setStored] = useState<StoredReport[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (orgId === undefined) return;
    try {
      const [catalogueResponse, storedResponse] = await Promise.all([
        api.get<{ reports: CatalogueEntry[] }>(`/api/v1/reports/${orgId}/catalogue`),
        api.get<{ reports: StoredReport[] }>(`/api/v1/reports/${orgId}`),
      ]);
      setCatalogue(catalogueResponse.reports);
      setStored(storedResponse.reports);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : null);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = useCallback(
    async (kind: string) => {
      if (orgId === undefined) return;
      setBusy(kind);
      setError(null);
      try {
        await api.post(`/api/v1/reports/${orgId}/${kind}`);
        await load();
      } catch (caught) {
        setError(caught instanceof ApiError ? caught : null);
      } finally {
        setBusy(null);
      }
    },
    [orgId, load],
  );

  if (error !== null && catalogue === null) {
    return <ErrorState title="Could not load reports" message={error.message} requestId={error.requestId} />;
  }
  if (catalogue === null) return <Loading what="reports" />;

  // Reports about one specific thing are produced from that thing's own page,
  // where the subject is unambiguous.
  const generalReports = catalogue.filter((entry) => !entry.needsSubject);

  return (
    <div className="stack-lg">
      <header className="page-head">
        <h1 style={{ fontSize: 'var(--step-3)' }}>Reports</h1>
        <p className="lede">
          Built from your recorded data at the moment you generate them. Each states its own
          assumptions, so a reader knows what the document does and does not claim.
        </p>
      </header>

      {error !== null && (
        <div className="notice notice-error" role="alert">
          {error.message}
        </div>
      )}

      <section>
        <div className="tier-head">
          <h2 className="tier-title">Available</h2>
        </div>
        <div className="grid-2">
          {generalReports.map((entry) => (
            <article key={entry.kind} className="card">
              <h3 style={{ fontSize: 'var(--step-1)' }}>{entry.title}</h3>
              <p className="muted" style={{ marginTop: 'var(--s-2)', fontSize: 'var(--step--1)' }}>
                {entry.description}
              </p>
              <div className="row" style={{ marginTop: 'var(--s-4)' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={busy !== null}
                  onClick={() => void generate(entry.kind)}
                >
                  {busy === entry.kind ? 'Generating…' : 'Generate and keep'}
                </button>
                <a
                  className="btn btn-sm"
                  href={`/api/v1/reports/${orgId}/preview/${entry.kind}?format=html`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Preview
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="tier-head">
          <h2 className="tier-title">Generated</h2>
          <span className="faint" style={{ fontSize: 'var(--step--1)' }}>
            Kept exactly as issued. Newest first.
          </span>
        </div>

        {stored.length === 0 ? (
          <Empty title="Nothing generated yet.">
            <p className="muted">
              Generating keeps a copy, so the version you hand to someone stays the version they
              can come back to.
            </p>
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Report</th>
                  <th>Generated</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {stored.map((report) => (
                  <tr key={report.id}>
                    <td>
                      <strong>{report.title}</strong>
                    </td>
                    <td className="timeline-when" style={{ whiteSpace: 'nowrap' }}>
                      {new Date(report.createdAt).toLocaleString()}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 'var(--s-2)' }}>
                        {FORMATS.map((format) => (
                          <a
                            key={format.id}
                            className="btn btn-sm"
                            href={`/api/v1/reports/${orgId}/${report.id}/download?format=${format.id}`}
                          >
                            {format.label}
                          </a>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="faint" style={{ fontSize: 'var(--step--1)' }}>
        <Eyebrow>A note on PDFs</Eyebrow>
        PDFs are generated on the server, not printed from the browser, so the file you download is
        the same file every time regardless of who downloads it.
      </p>
    </div>
  );
}
