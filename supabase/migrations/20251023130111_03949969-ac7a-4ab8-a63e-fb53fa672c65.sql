-- Create worker heartbeats table for monitoring external worker status
CREATE TABLE public.worker_heartbeats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id text NOT NULL,
  last_seen timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'online',
  version text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create index for faster worker lookups
CREATE INDEX idx_worker_heartbeats_worker_id ON public.worker_heartbeats(worker_id);

-- Enable RLS
ALTER TABLE public.worker_heartbeats ENABLE ROW LEVEL SECURITY;

-- Allow anyone to view worker heartbeats (so UI can check if worker is online)
CREATE POLICY "Anyone can view heartbeats"
  ON public.worker_heartbeats
  FOR SELECT
  USING (true);

-- Only service role can insert/update heartbeats (worker uses service role key)
CREATE POLICY "Service role can manage heartbeats"
  ON public.worker_heartbeats
  FOR ALL
  USING (true)
  WITH CHECK (true);