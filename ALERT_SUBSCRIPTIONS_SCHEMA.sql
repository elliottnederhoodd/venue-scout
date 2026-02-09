-- Create alert_subscriptions table
CREATE TABLE IF NOT EXISTS alert_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  threshold smallint NOT NULL CHECK (threshold BETWEEN 1 AND 2),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_triggered_at timestamptz NULL,
  CONSTRAINT unique_subscription UNIQUE(venue_id, device_id, threshold)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_active ON alert_subscriptions(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_alert_subscriptions_venue ON alert_subscriptions(venue_id);

-- RLS Policies (simplified version - allow all operations for now)
-- Note: In production, you should restrict by device_id using auth
ALTER TABLE alert_subscriptions ENABLE ROW LEVEL SECURITY;

-- Allow all operations (simplified for now)
-- In production, add policies like:
-- CREATE POLICY "Users can manage their own subscriptions"
--   ON alert_subscriptions
--   FOR ALL
--   USING (device_id = current_setting('app.device_id', true));

-- For now, allow all (same as reports table)
CREATE POLICY "Allow all operations on alert_subscriptions"
  ON alert_subscriptions
  FOR ALL
  USING (true)
  WITH CHECK (true);
