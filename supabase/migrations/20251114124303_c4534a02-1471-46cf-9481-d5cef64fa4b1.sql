-- Health check requests table
CREATE TABLE health_check_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_ids jsonb NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','done','failed')),
  assigned_worker_id text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_health_check_status ON health_check_requests(status);
CREATE INDEX idx_health_check_created ON health_check_requests(created_at DESC);

-- Enable RLS
ALTER TABLE health_check_requests ENABLE ROW LEVEL SECURITY;

-- Users can view own requests
CREATE POLICY "Users can view own requests"
  ON health_check_requests FOR SELECT
  USING (created_by = auth.uid());

-- Users can create requests
CREATE POLICY "Users can create requests"
  ON health_check_requests FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- Service role can update requests
CREATE POLICY "Service role can update requests"
  ON health_check_requests FOR UPDATE
  USING (true);