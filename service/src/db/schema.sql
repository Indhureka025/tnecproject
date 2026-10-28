-- EC Service schema. Applied idempotently on startup by src/db/pg.ts.

CREATE TABLE IF NOT EXISTS ec_requests (
  request_id      uuid PRIMARY KEY,
  idempotency_key text UNIQUE NOT NULL,
  param_hash      text NOT NULL,
  status          text NOT NULL,
  certified       boolean NOT NULL,
  reference       text,
  request_json    jsonb NOT NULL,
  status_json     jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ec_requests_param_hash_idx
  ON ec_requests (param_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS ec_request_audit (
  id         bigserial PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES ec_requests(request_id),
  at         timestamptz NOT NULL DEFAULT now(),
  event      text NOT NULL,
  detail     jsonb
);

CREATE INDEX IF NOT EXISTS ec_request_audit_request_idx
  ON ec_request_audit (request_id, at);

-- Durable job queue (replaces the in-process queue for BACKEND=postgres).
CREATE TABLE IF NOT EXISTS jobs (
  id           uuid PRIMARY KEY,
  kind         text NOT NULL,
  payload      jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'queued',   -- queued | active | done | failed
  attempts     int  NOT NULL DEFAULT 0,
  max_attempts int  NOT NULL DEFAULT 5,
  run_at       timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_pickup_idx
  ON jobs (status, run_at) WHERE status = 'queued';

-- Object metadata (bytes live in the object store; this is the index).
CREATE TABLE IF NOT EXISTS documents (
  id          uuid PRIMARY KEY,
  request_id  uuid NOT NULL,
  kind        text NOT NULL,            -- ec_pdf | raw_html | screenshot
  content_type text NOT NULL,
  bytes       int NOT NULL,
  sha256      text NOT NULL,
  storage_key text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_request_idx ON documents (request_id);
