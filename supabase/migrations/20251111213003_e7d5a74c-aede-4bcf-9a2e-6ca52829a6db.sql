-- Add worker_type and machine_info columns to worker_heartbeats
ALTER TABLE worker_heartbeats 
  ADD COLUMN IF NOT EXISTS worker_type TEXT DEFAULT 'cloud' CHECK (worker_type IN ('cloud', 'desktop')),
  ADD COLUMN IF NOT EXISTS machine_info JSONB DEFAULT '{}'::jsonb;

-- Create index for active desktop workers
CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_type_status 
  ON worker_heartbeats(worker_type, status, last_seen);

-- Add worker assignment columns to emoji_tasks
ALTER TABLE emoji_tasks
  ADD COLUMN IF NOT EXISTS assigned_worker_id TEXT,
  ADD COLUMN IF NOT EXISTS processing_mode TEXT DEFAULT 'edge_function' CHECK (processing_mode IN ('edge_function', 'desktop_worker'));

-- Create index for task assignment
CREATE INDEX IF NOT EXISTS idx_emoji_tasks_worker 
  ON emoji_tasks(status, processing_mode, assigned_worker_id);

-- RLS policy: Desktop workers can claim tasks
CREATE POLICY "Desktop workers can claim tasks"
  ON emoji_tasks
  FOR UPDATE
  USING (
    status IN ('queued', 'processing') 
    AND processing_mode = 'desktop_worker'
  );

-- RLS policy: Desktop workers can update their heartbeats
CREATE POLICY "Desktop workers can manage own heartbeat"
  ON worker_heartbeats
  FOR ALL
  USING (worker_type = 'desktop')
  WITH CHECK (worker_type = 'desktop');

-- Add worker_id column to emoji_task_logs
ALTER TABLE emoji_task_logs
  ADD COLUMN IF NOT EXISTS worker_id TEXT;

-- Create desktop_worker_configs table (optional, for user preferences)
CREATE TABLE IF NOT EXISTS desktop_worker_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  worker_id TEXT UNIQUE NOT NULL,
  is_enabled BOOLEAN DEFAULT true,
  auto_start BOOLEAN DEFAULT false,
  batch_size INTEGER DEFAULT 8,
  poll_interval INTEGER DEFAULT 5000,
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS for desktop_worker_configs
ALTER TABLE desktop_worker_configs ENABLE ROW LEVEL SECURITY;

-- RLS: Users can manage own worker configs
CREATE POLICY "Users can manage own worker configs"
  ON desktop_worker_configs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);