/**
 * First organization.
 *
 * Deliberately short. The product asks for a name, where the organization
 * mainly operates, and a few areas of the business that matter — and then gets
 * out of the way. A long setup form before anyone has seen any value is how
 * this kind of tool gets abandoned.
 */

import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, ApiError } from '../lib/api';
import { useSession } from '../state/session';

interface CreatedOrg {
  organization: { id: string; name: string };
}

export function SetupPage(): ReactNode {
  const navigate = useNavigate();
  const { me, refresh } = useSession();

  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [areas, setAreas] = useState<string[]>(['', '', '']);
  const [busy, setBusy] = useState<'none' | 'create' | 'demo'>('none');
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (kind: 'create' | 'demo', work: () => Promise<CreatedOrg>) => {
      if (busy !== 'none') return;
      setBusy(kind);
      setError(null);
      try {
        const result = await work();
        await refresh();
        navigate(`/o/${result.organization.id}`, { replace: true });
      } catch (caught) {
        setError(
          caught instanceof ApiError ? caught.message : 'Something unexpected went wrong.',
        );
        setBusy('none');
      }
    },
    [busy, refresh, navigate],
  );

  return (
    <div className="auth">
      <div className="auth-inner" style={{ maxWidth: '34rem' }}>
        <header>
          <p className="auth-mark">C.O.R.E.</p>
          <p className="auth-wordmark">Continuity · Operations · Risk · Execution</p>
        </header>

        <form
          className="auth-card card stack"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void run('create', () =>
              api.post<CreatedOrg>('/api/v1/organizations', {
                name,
                primaryRegion: region.trim() === '' ? undefined : region.trim(),
                importantAreas: areas.map((area) => area.trim()).filter((area) => area !== ''),
              }),
            );
          }}
        >
          <div>
            <h1 style={{ fontSize: 'var(--step-2)' }}>
              {me === null ? 'Set up your organization' : `Welcome, ${me.user.name.split(' ')[0]}`}
            </h1>
            <p className="muted" style={{ marginTop: 'var(--s-2)' }}>
              Three questions now. You can build out the rest whenever you like.
            </p>
          </div>

          <label className="field">
            <span>Organization name</span>
            <input required value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <label className="field">
            <span>Where do you mainly operate?</span>
            <input
              value={region}
              placeholder="United Kingdom"
              onChange={(event) => setRegion(event.target.value)}
            />
            <span className="hint">Optional.</span>
          </label>

          <fieldset style={{ border: 0, padding: 0 }}>
            <legend
              className="field"
              style={{
                fontSize: 'var(--step--1)',
                fontWeight: 600,
                color: 'var(--ink-soft)',
                marginBottom: 'var(--s-2)',
                padding: 0,
              }}
            >
              What are the most important things your organization does?
            </legend>
            <div className="stack-sm">
              {areas.map((area, index) => (
                <input
                  // Index is the identity here: these are fixed positional slots.
                  key={index}
                  className="field"
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.75rem',
                    border: '1px solid var(--line-strong)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--paper-raised)',
                  }}
                  value={area}
                  placeholder={
                    ['Pay staff', 'Dispatch customer orders', 'Answer customer enquiries'][index] ??
                    'Another important area'
                  }
                  onChange={(event) => {
                    const next = [...areas];
                    next[index] = event.target.value;
                    setAreas(next);
                  }}
                />
              ))}
            </div>
            <p className="hint" style={{ marginTop: 'var(--s-2)', fontSize: 'var(--step--1)', color: 'var(--ink-faint)' }}>
              Each becomes a business function you can build out. Leave any blank.
            </p>
          </fieldset>

          {error !== null && (
            <p className="error" role="alert" style={{ color: 'var(--band-critical)' }}>
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary" disabled={busy !== 'none'}>
            {busy === 'create' ? 'Creating…' : 'Create organization'}
          </button>
        </form>

        {me?.capabilities.demoMode === true && (
          <div className="card stack" style={{ marginTop: 'var(--s-5)' }}>
            <div>
              <h2 style={{ fontSize: 'var(--step-1)' }}>Or look around first</h2>
              <p className="muted" style={{ marginTop: 'var(--s-2)', fontSize: 'var(--step--1)' }}>
                A worked example: a logistics company with a payroll process only one person can
                run, a supplier with no second source, and a database two critical functions sit
                on. The company is invented. The analysis of it is the real engine.
              </p>
            </div>
            <button
              type="button"
              className="btn"
              disabled={busy !== 'none'}
              onClick={() => void run('demo', () => api.post<CreatedOrg>('/api/v1/organizations/demo'))}
            >
              {busy === 'demo' ? 'Building…' : 'Open the demo organization'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
