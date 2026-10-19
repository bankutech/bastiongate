CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  gym_name text,
  contact text NOT NULL,
  message text,
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_recent ON leads (created_at DESC);
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;
CREATE POLICY super_only ON leads
  USING (current_setting('app.role', true) = 'super')
  WITH CHECK (current_setting('app.role', true) = 'super');
