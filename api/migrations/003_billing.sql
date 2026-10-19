CREATE TABLE webhook_events (
  event_id text PRIMARY KEY,
  event text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events FORCE ROW LEVEL SECURITY;
CREATE POLICY super_only ON webhook_events
  USING (current_setting('app.role', true) = 'super')
  WITH CHECK (current_setting('app.role', true) = 'super');

ALTER TABLE devices ADD COLUMN last_heartbeat jsonb;
ALTER TABLE devices ADD COLUMN last_heartbeat_at timestamptz;
