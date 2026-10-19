CREATE TABLE subject_events (
  tenant_id text NOT NULL REFERENCES tenants(id),
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  last_event_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, subject_type, subject_id)
);
ALTER TABLE subject_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON subject_events
  USING (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.role', true) = 'super')
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.role', true) = 'super');
