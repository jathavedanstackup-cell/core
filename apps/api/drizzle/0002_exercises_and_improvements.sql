-- Exercises, after-action reviews and preventive improvements.
--
-- An exercise is a rehearsal: C.O.R.E. computes what it expects to happen from
-- the organization model, the participants record what actually happened, and
-- the review is the difference between the two. Storing the expectation at the
-- start is what makes that comparison honest — the model may change afterwards,
-- and the review must not silently change with it.

CREATE TABLE exercises (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  reference                 TEXT NOT NULL,
  title                     TEXT NOT NULL,
  objective                 TEXT,
  -- What the exercise assumes becomes unavailable.
  scenario_refs             JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- The engine's prediction, captured when the exercise starts and never
  -- recomputed, so EXPECTED versus ACTUAL stays meaningful over time.
  expected_result           JSONB,
  status                    TEXT NOT NULL DEFAULT 'PLANNED',
  started_at                TIMESTAMPTZ,
  ended_at                  TIMESTAMPTZ,
  -- Minutes. Target comes from the affected functions' recovery objectives.
  expected_recovery_minutes INTEGER,
  actual_recovery_minutes   INTEGER,
  review                    JSONB,
  owner_id                  UUID REFERENCES users (id) ON DELETE SET NULL,
  created_by                UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT exercises_status_check CHECK (status IN (
    'PLANNED', 'RUNNING', 'COMPLETED', 'CANCELLED')),
  -- A running or finished exercise must say when it started, and a finished one
  -- must say when it ended. Nothing may claim a duration it cannot support.
  CONSTRAINT exercises_running_has_start CHECK (
    (status IN ('PLANNED', 'CANCELLED')) OR (started_at IS NOT NULL)),
  CONSTRAINT exercises_completed_has_end CHECK (
    (status <> 'COMPLETED') OR (ended_at IS NOT NULL)),
  CONSTRAINT exercises_minutes_check CHECK (
    (expected_recovery_minutes IS NULL OR expected_recovery_minutes >= 0) AND
    (actual_recovery_minutes IS NULL OR actual_recovery_minutes >= 0))
);
CREATE UNIQUE INDEX exercises_org_reference_key ON exercises (org_id, reference);
CREATE INDEX exercises_org_status_idx ON exercises (org_id, status);

CREATE TABLE exercise_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  description TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  actor_id    UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT exercise_events_kind_check CHECK (kind IN (
    'injection', 'decision', 'action', 'observation', 'gap', 'recovery', 'note'))
);
CREATE INDEX exercise_events_exercise_occurred_idx
  ON exercise_events (exercise_id, occurred_at);

-- Preventive improvements: the answer to "how do we make this less likely next
-- time?". Distinct from actions, which close a specific weakness now.
CREATE TABLE improvements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  rationale           TEXT,
  expected_benefit    TEXT,
  verification        TEXT,
  priority            TEXT NOT NULL DEFAULT 'P2',
  status              TEXT NOT NULL DEFAULT 'PROPOSED',
  owner_hint          TEXT,
  assigned_to         UUID REFERENCES users (id) ON DELETE SET NULL,
  -- Where this came from: an exercise, an incident, or a finding.
  source_exercise_id  UUID REFERENCES exercises (id) ON DELETE SET NULL,
  source_incident_id  UUID REFERENCES incidents (id) ON DELETE SET NULL,
  source_finding_ref  TEXT,
  due_at              TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_by          UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT improvements_priority_check CHECK (priority IN ('P1', 'P2', 'P3')),
  CONSTRAINT improvements_status_check CHECK (status IN (
    'PROPOSED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'DECLINED')),
  CONSTRAINT improvements_completed_has_time CHECK (
    (status <> 'COMPLETED') OR (completed_at IS NOT NULL))
);
CREATE INDEX improvements_org_status_idx ON improvements (org_id, status);
CREATE INDEX improvements_org_source_idx ON improvements (org_id, source_exercise_id);

-- Generated reports, kept so a report handed to a board can be reopened exactly
-- as it was rather than silently regenerated from newer data.
CREATE TABLE reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  -- The rendered content, as structured data. Formats are produced from this.
  payload      JSONB NOT NULL,
  generated_by UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reports_kind_check CHECK (kind IN (
    'risk', 'readiness', 'dependencies', 'scenario', 'incident',
    'exercise', 'improvements'))
);
CREATE INDEX reports_org_created_idx ON reports (org_id, created_at DESC);
