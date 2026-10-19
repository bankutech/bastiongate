CREATE TABLE devices (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  label text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  revoked boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sync_downstream (
  seq bigserial PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  device_id text,
  kind text NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_downstream_tenant_seq ON sync_downstream (tenant_id, seq);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['devices','sync_downstream'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_scope ON %I
      USING (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.role', true) = 'super')
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.role', true) = 'super')$p$, t);
  END LOOP;
END $$;
