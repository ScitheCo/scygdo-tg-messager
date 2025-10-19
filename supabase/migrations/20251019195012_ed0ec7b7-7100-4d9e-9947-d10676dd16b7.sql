-- Add new status types for member scraping logs
-- This enables better progress tracking and control

-- First, let's check the current constraint and drop it if exists
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'member_scraping_logs_status_check'
  ) THEN
    ALTER TABLE public.member_scraping_logs DROP CONSTRAINT member_scraping_logs_status_check;
  END IF;
END $$;

-- Add new constraint with extended status values
ALTER TABLE public.member_scraping_logs 
ADD CONSTRAINT member_scraping_logs_status_check 
CHECK (status IN ('success', 'error', 'skipped', 'in_progress', 'paused', 'cancelled', 'flood_wait'));

-- Add comment to explain status values
COMMENT ON COLUMN public.member_scraping_logs.status IS 'Status values: success (completed), error (failed), skipped (limit reached), in_progress (currently running), paused (user paused), cancelled (user cancelled), flood_wait (waiting for flood to clear)';