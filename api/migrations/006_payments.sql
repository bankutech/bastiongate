CREATE TABLE payment_links (
  payment_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  subject_id text NOT NULL,
  link_id text NOT NULL,
  short_url text NOT NULL,
  amount_paise bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payment_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON payment_links
  USING (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.role', true) = 'super')
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.role', true) = 'super');

ALTER TABLE tenants ADD COLUMN razorpay_account_id text;
ALTER TABLE tenants ADD COLUMN route_product_id text;
ALTER TABLE tenants ADD COLUMN route_step text NOT NULL DEFAULT 'NONE';
