-- C.O.R.E. initial schema.
-- Instants are timestamptz and stored in UTC. Every organizational table
-- carries org_id and is indexed on it, because every query filters by tenant.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT NOT NULL,
  name              TEXT NOT NULL,
  password_hash     TEXT,
  email_verified_at TIMESTAMPTZ,
  google_subject    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);
CREATE UNIQUE INDEX users_google_subject_key ON users (google_subject);

CREATE TABLE sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent   TEXT
);
CREATE UNIQUE INDEX sessions_token_hash_key ON sessions (token_hash);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TABLE verification_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  purpose     TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX verification_codes_user_purpose_idx ON verification_codes (user_id, purpose);

CREATE TABLE organizations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  primary_region TEXT,
  is_demo        BOOLEAN NOT NULL DEFAULT FALSE,
  timezone       TEXT NOT NULL DEFAULT 'UTC',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'VIEWER',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memberships_role_check CHECK (role IN ('ADMIN', 'LEADER', 'OPERATOR', 'VIEWER'))
);
CREATE UNIQUE INDEX memberships_org_user_key ON memberships (org_id, user_id);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE entities (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  ref                  TEXT NOT NULL,
  kind                 TEXT NOT NULL,
  name                 TEXT NOT NULL,
  description          TEXT,
  criticality          TEXT,
  owner_id             UUID,
  alternate_ids        JSONB NOT NULL DEFAULT '[]'::jsonb,
  procedure_documented BOOLEAN,
  last_tested_at       TIMESTAMPTZ,
  contacts_verified_at TIMESTAMPTZ,
  access_verified_at   TIMESTAMPTZ,
  mtd_minutes          INTEGER,
  rto_minutes          INTEGER,
  rpo_minutes          INTEGER,
  tags                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT entities_kind_check CHECK (kind IN (
    'business_function', 'process', 'application', 'service', 'vendor',
    'team', 'person', 'location', 'facility', 'data_asset')),
  CONSTRAINT entities_criticality_check CHECK (
    criticality IS NULL OR criticality IN ('LOW', 'MODERATE', 'HIGH', 'CRITICAL')),
  CONSTRAINT entities_minutes_check CHECK (
    (mtd_minutes IS NULL OR mtd_minutes >= 0) AND
    (rto_minutes IS NULL OR rto_minutes >= 0) AND
    (rpo_minutes IS NULL OR rpo_minutes >= 0))
);
CREATE UNIQUE INDEX entities_org_ref_key ON entities (org_id, ref);
CREATE INDEX entities_org_kind_idx ON entities (org_id, kind);

CREATE TABLE dependencies (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  ref                    TEXT NOT NULL,
  dependent_ref          TEXT NOT NULL,
  provider_ref           TEXT NOT NULL,
  type                   TEXT NOT NULL DEFAULT 'requires',
  optional               BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_provider_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  tolerance_minutes      INTEGER,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dependencies_type_check CHECK (type IN (
    'requires', 'operates', 'hosts', 'supplies', 'staffs', 'stores', 'authenticates')),
  CONSTRAINT dependencies_not_self CHECK (dependent_ref <> provider_ref)
);
CREATE UNIQUE INDEX dependencies_org_ref_key ON dependencies (org_id, ref);
CREATE INDEX dependencies_org_provider_idx ON dependencies (org_id, provider_ref);
CREATE INDEX dependencies_org_dependent_idx ON dependencies (org_id, dependent_ref);

CREATE TABLE scenario_runs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  created_by         UUID REFERENCES users (id) ON DELETE SET NULL,
  description        TEXT NOT NULL,
  failed_entity_refs JSONB NOT NULL,
  result             JSONB NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX scenario_runs_org_created_idx ON scenario_runs (org_id, created_at DESC);

CREATE TABLE incidents (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  reference            TEXT NOT NULL,
  title                TEXT NOT NULL,
  description          TEXT,
  severity             TEXT NOT NULL DEFAULT 'SEV3',
  status               TEXT NOT NULL DEFAULT 'OPEN',
  started_at           TIMESTAMPTZ NOT NULL,
  resolved_at          TIMESTAMPTZ,
  owner_id             UUID REFERENCES users (id) ON DELETE SET NULL,
  affected_entity_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by           UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT incidents_severity_check CHECK (severity IN ('SEV1', 'SEV2', 'SEV3', 'SEV4')),
  CONSTRAINT incidents_status_check CHECK (status IN (
    'OPEN', 'INVESTIGATING', 'CONTAINED', 'RECOVERING', 'RESOLVED', 'CLOSED'))
);
CREATE UNIQUE INDEX incidents_org_reference_key ON incidents (org_id, reference);
CREATE INDEX incidents_org_status_idx ON incidents (org_id, status);

CREATE TABLE incident_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  incident_id UUID NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  description TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  actor_id    UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT incident_events_kind_check CHECK (kind IN (
    'trigger', 'detection', 'decision', 'action', 'delay', 'recovery', 'verification', 'note'))
);
CREATE INDEX incident_events_incident_occurred_idx ON incident_events (incident_id, occurred_at);

CREATE TABLE actions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'READY',
  priority     TEXT NOT NULL DEFAULT 'P2',
  owner_hint   TEXT,
  assigned_to  UUID REFERENCES users (id) ON DELETE SET NULL,
  finding_ref  TEXT,
  option_ref   TEXT,
  verification TEXT,
  notes        TEXT,
  incident_id  UUID REFERENCES incidents (id) ON DELETE SET NULL,
  due_at       TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by   UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT actions_status_check CHECK (status IN (
    'READY', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED')),
  CONSTRAINT actions_priority_check CHECK (priority IN ('P1', 'P2', 'P3')),
  -- A completed action must say when. Nothing may claim success without a time.
  CONSTRAINT actions_completed_has_time CHECK (
    (status <> 'COMPLETED') OR (completed_at IS NOT NULL))
);
CREATE INDEX actions_org_status_idx ON actions (org_id, status);
CREATE INDEX actions_org_finding_idx ON actions (org_id, finding_ref);

CREATE TABLE audit_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID REFERENCES organizations (id) ON DELETE CASCADE,
  actor_id    UUID REFERENCES users (id) ON DELETE SET NULL,
  actor_email TEXT,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  action      TEXT NOT NULL,
  before      JSONB,
  after       JSONB,
  request_id  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_org_created_idx ON audit_events (org_id, created_at DESC);
CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id);
