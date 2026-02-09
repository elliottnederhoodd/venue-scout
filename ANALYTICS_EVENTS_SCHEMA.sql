-- Create analytics_events table
CREATE TABLE IF NOT EXISTS analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL,
  venue_id uuid NULL REFERENCES venues(id) ON DELETE SET NULL,
  device_id text NOT NULL,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_analytics_events_event ON analytics_events(event);
CREATE INDEX IF NOT EXISTS idx_analytics_events_venue ON analytics_events(venue_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_device ON analytics_events(device_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created ON analytics_events(created_at);

-- RLS Policies (permissive, similar to reports)
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Allow all operations (simplified for now)
CREATE POLICY "Allow all operations on analytics_events"
  ON analytics_events
  FOR ALL
  USING (true)
  WITH CHECK (true);
