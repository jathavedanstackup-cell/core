/**
 * Incidents and their timelines.
 *
 * The timeline runs oldest first and is ordered by when things actually
 * happened, not when somebody typed them, so a late entry lands in its true
 * place. Times are shown absolutely; "2 hours ago" is not a fact you can
 * reconstruct a decision from.
 */

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { Empty, ErrorState, Eyebrow, Loading } from '../components/Bits';
import { api, ApiError } from '../lib/api';

interface Incident {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  severity: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';
  status: string;
  startedAt: string;
  resolvedAt: string | null;
}

interface TimelineEvent {
  id: string;
  kind: string;
  description: string;
  occurredAt: string;
  recordedAt: string;
  actor: { id: string; name: string } | null;
}

const STATUSES = ['OPEN', 'INVESTIGATING', 'CONTAINED', 'RECOVERING', 'RESOLVED', 'CLOSED'];

const SEVERITY_TONE: Record<Incident['severity'], string> = {
  SEV1: 'CRITICAL',
  SEV2: 'HIGH',
  SEV3: 'MODERATE',
  SEV4: 'LOW',
};

export function IncidentsPage(): ReactNode {
  const { orgId } = useParams<{ orgId: string }>();
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<Incident['severity']>('SEV3');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (orgId === undefined) return;
    try {
      const response = await api.get<{ incidents: Incident[] }>(`/api/v1/incidents/${orgId}`);
      setIncidents(response.incidents);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : null);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openIncident = useCallback(
    async (id: string) => {
      if (orgId === undefined) return;
      if (openId === id) {
        setOpenId(null);
        return;
      }
      const response = await api.get<{ timeline: TimelineEvent[] }>(
        `/api/v1/incidents/${orgId}/${id}`,
      );
      setTimeline(response.timeline);
      setOpenId(id);
    },
    [orgId, openId],
  );

  const create = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (orgId === undefined || busy || title.trim() === '') return;
      setBusy(true);
      setError(null);
      try {
        await api.post(`/api/v1/incidents/${orgId}`, { title: title.trim(), severity });
        setTitle('');
        await load();
      } catch (caught) {
        setError(caught instanceof ApiError ? caught : null);
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy, title, severity, load],
  );

  const changeStatus = useCallback(
    async (incident: Incident, status: string) => {
      if (orgId === undefined) return;
      await api.patch(`/api/v1/incidents/${orgId}/${incident.id}`, { status });
      await load();
      if (openId === incident.id) {
        const response = await api.get<{ timeline: TimelineEvent[] }>(
          `/api/v1/incidents/${orgId}/${incident.id}`,
        );
        setTimeline(response.timeline);
      }
    },
    [orgId, load, openId],
  );

  const addEvent = useCallback(
    async (incidentId: string) => {
      if (orgId === undefined || note.trim() === '') return;
      await api.post(`/api/v1/incidents/${orgId}/${incidentId}/events`, {
        kind: 'note',
        description: note.trim(),
      });
      setNote('');
      const response = await api.get<{ timeline: TimelineEvent[] }>(
        `/api/v1/incidents/${orgId}/${incidentId}`,
      );
      setTimeline(response.timeline);
    },
    [orgId, note],
  );

  if (error !== null && incidents === null) {
    return <ErrorState title="Could not load incidents" message={error.message} requestId={error.requestId} />;
  }
  if (incidents === null) return <Loading what="incidents" />;

  return (
    <div className="stack-lg">
      <header className="page-head">
        <h1 style={{ fontSize: 'var(--step-3)' }}>Incidents</h1>
        <p className="lede">
          Every incident keeps a chronological record of what happened and when, so the response can
          be reviewed afterwards rather than remembered.
        </p>
      </header>

      <form className="card row" onSubmit={(event) => void create(event)}>
        <input
          style={{
            flex: '1 1 18rem',
            padding: '0.6rem 0.75rem',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--paper-raised)',
          }}
          placeholder="What is happening?"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <select
          value={severity}
          onChange={(event) => setSeverity(event.target.value as Incident['severity'])}
          style={{
            padding: '0.6rem 0.75rem',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--paper-raised)',
          }}
        >
          <option value="SEV1">SEV1 — critical</option>
          <option value="SEV2">SEV2 — major</option>
          <option value="SEV3">SEV3 — moderate</option>
          <option value="SEV4">SEV4 — minor</option>
        </select>
        <button type="submit" className="btn btn-primary" disabled={busy || title.trim() === ''}>
          Declare incident
        </button>
      </form>

      {error !== null && (
        <div className="notice notice-error" role="alert">
          {error.message}
        </div>
      )}

      {incidents.length === 0 ? (
        <Empty title="No incidents recorded.">
          <p className="muted">That is the preferred state.</p>
        </Empty>
      ) : (
        <ul className="finding-list">
          {incidents.map((incident) => (
            <li key={incident.id}>
              <div className="finding" style={{ cursor: 'default' }}>
                <div className="finding-top">
                  <span className={`band band-${SEVERITY_TONE[incident.severity]}`}>
                    {incident.severity}
                  </span>
                  <span className="finding-subject">{incident.title}</span>
                  <span className="finding-kind">{incident.reference}</span>
                  <span className="tag">{incident.status.toLowerCase()}</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    style={{ marginLeft: 'auto' }}
                    aria-expanded={openId === incident.id}
                    onClick={() => void openIncident(incident.id)}
                  >
                    {openId === incident.id ? 'Hide timeline' : 'Timeline'}
                  </button>
                </div>

                <p className="finding-rationale">
                  Started {new Date(incident.startedAt).toLocaleString()}
                  {incident.resolvedAt !== null &&
                    ` · resolved ${new Date(incident.resolvedAt).toLocaleString()}`}
                </p>

                <div className="row" style={{ marginTop: 'var(--s-3)' }}>
                  <a
                    className="btn btn-sm"
                    href={`/api/v1/reports/${orgId}/preview/incident?format=pdf&subject=${incident.id}&download=true`}
                  >
                    Download review (PDF)
                  </a>
                  {STATUSES.filter((status) => status !== incident.status).map((status) => (
                    <button
                      key={status}
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void changeStatus(incident, status)}
                    >
                      {status.toLowerCase()}
                    </button>
                  ))}
                </div>

                {openId === incident.id && (
                  <div style={{ marginTop: 'var(--s-5)' }}>
                    <Eyebrow>Timeline — oldest first</Eyebrow>
                    <ul className="timeline" style={{ marginTop: 'var(--s-3)' }}>
                      {timeline.map((event) => (
                        <li key={event.id}>
                          <span className="timeline-when">
                            {new Date(event.occurredAt).toLocaleString()}
                          </span>
                          <span>
                            <span className="timeline-kind">{event.kind}</span>
                            <span style={{ display: 'block' }}>{event.description}</span>
                            {event.actor !== null && (
                              <span className="verify-note">Recorded by {event.actor.name}</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>

                    <div className="row" style={{ marginTop: 'var(--s-4)' }}>
                      <input
                        style={{
                          flex: '1 1 16rem',
                          padding: '0.5rem 0.7rem',
                          border: '1px solid var(--line-strong)',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--paper-raised)',
                        }}
                        placeholder="Add to the timeline"
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={note.trim() === ''}
                        onClick={() => void addEvent(incident.id)}
                      >
                        Record
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
