CREATE TABLE support_tickets (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  subject text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PENDING', 'RESOLVED')),
  diagnostics jsonb NOT NULL DEFAULT '{}',
  sla_due_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_tickets_queue ON support_tickets (status, sla_due_at);

CREATE TABLE ticket_replies (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES support_tickets(id),
  tenant_id text NOT NULL REFERENCES tenants(id),
  author text NOT NULL CHECK (author IN ('GYM', 'ADMIN')),
  author_label text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_replies_ticket ON ticket_replies (ticket_id, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_tickets', 'ticket_replies'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_scope ON %I
      USING (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.role', true) = 'super')
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.role', true) = 'super')$p$, t);
  END LOOP;
END $$;
