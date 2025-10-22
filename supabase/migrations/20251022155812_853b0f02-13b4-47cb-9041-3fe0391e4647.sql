-- Add error_message column to scraping_sessions table
ALTER TABLE scraping_sessions ADD COLUMN IF NOT EXISTS error_message TEXT;