CREATE TABLE tenants (
  id text PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  master_lease_valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE members (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  device_user_id text NOT NULL,
  full_name text NOT NULL,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, device_user_id)
);

CREATE TABLE lease_counters (
  tenant_id text NOT NULL REFERENCES tenants(id),
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  nonce bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, subject_type, subject_id)
);

CREATE TABLE leases (
  lease_id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  monotonic_nonce bigint NOT NULL,
  valid_until timestamptz NOT NULL,
  payload jsonb NOT NULL,
  signature text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, subject_type, subject_id, monotonic_nonce)
);
CREATE INDEX leases_latest ON leases (tenant_id, subject_type, subject_id, monotonic_nonce DESC);

CREATE TABLE sync_events (
  seq bigserial PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  tenant_id text NOT NULL REFERENCES tenants(id),
  device_id text NOT NULL,
  kind text NOT NULL,
  occurred_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_events_tenant_seq ON sync_events (tenant_id, seq);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['members','lease_counters','leases','sync_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_scope ON %I
      USING (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.role', true) = 'super')
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.role', true) = 'super')$p$, t);
  END LOOP;
END $$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON tenants
  USING (id = current_setting('app.tenant_id', true) OR current_setting('app.role', true) = 'super')
  WITH CHECK (id = current_setting('app.tenant_id', true) OR current_setting('app.role', true) = 'super');
