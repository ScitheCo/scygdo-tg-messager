-- Remove unnecessary columns from scraped_members table for optimization
-- Only keeping essential fields needed for adding members to groups

ALTER TABLE scraped_members 
DROP COLUMN IF EXISTS first_name,
DROP COLUMN IF EXISTS last_name,
DROP COLUMN IF EXISTS phone,
DROP COLUMN IF EXISTS username,
DROP COLUMN IF EXISTS processed_at,
DROP COLUMN IF EXISTS retry_count,
DROP COLUMN IF EXISTS error_reason;

-- Add index on status for faster queued member queries
CREATE INDEX IF NOT EXISTS idx_scraped_members_status ON scraped_members(status);

-- Add index on session_id and status for faster session queries
CREATE INDEX IF NOT EXISTS idx_scraped_members_session_status ON scraped_members(session_id, status);