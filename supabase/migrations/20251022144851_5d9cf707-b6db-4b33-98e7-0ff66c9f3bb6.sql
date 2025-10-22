-- Member Scraping V2: Complete System Tables

-- 1. Scraping Sessions Table
CREATE TABLE public.scraping_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'configuring' CHECK (status IN ('configuring', 'fetching_members', 'ready', 'running', 'paused', 'completed', 'cancelled', 'error')),
  source_group_input TEXT NOT NULL,
  source_group_id BIGINT,
  source_group_title TEXT,
  target_group_input TEXT NOT NULL,
  target_group_id BIGINT,
  target_group_title TEXT,
  settings JSONB NOT NULL DEFAULT '{}',
  total_members_fetched INTEGER NOT NULL DEFAULT 0,
  total_filtered_out INTEGER NOT NULL DEFAULT 0,
  total_in_queue INTEGER NOT NULL DEFAULT 0,
  total_processed INTEGER NOT NULL DEFAULT 0,
  total_success INTEGER NOT NULL DEFAULT 0,
  total_failed INTEGER NOT NULL DEFAULT 0,
  fetched_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 2. Scraped Members Table
CREATE TABLE public.scraped_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.scraping_sessions(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL,
  user_id BIGINT NOT NULL,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  access_hash BIGINT,
  phone TEXT,
  is_bot BOOLEAN NOT NULL DEFAULT false,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'success', 'failed', 'skipped')),
  processed_by_account_id UUID REFERENCES public.telegram_accounts(id) ON DELETE SET NULL,
  processed_at TIMESTAMP WITH TIME ZONE,
  error_reason TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(session_id, user_id)
);

-- 3. Session Accounts Table
CREATE TABLE public.session_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.scraping_sessions(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.telegram_accounts(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  added_today INTEGER NOT NULL DEFAULT 0,
  last_activity_at TIMESTAMP WITH TIME ZONE,
  flood_wait_until TIMESTAMP WITH TIME ZONE,
  total_attempts INTEGER NOT NULL DEFAULT 0,
  total_success INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(session_id, account_id)
);

-- Indexes for performance
CREATE INDEX idx_scraping_sessions_status ON public.scraping_sessions(status);
CREATE INDEX idx_scraping_sessions_created_by ON public.scraping_sessions(created_by);
CREATE INDEX idx_scraped_members_session_status ON public.scraped_members(session_id, status);
CREATE INDEX idx_scraped_members_sequence ON public.scraped_members(session_id, sequence_number);
CREATE INDEX idx_session_accounts_active ON public.session_accounts(session_id, is_active);

-- Enable RLS
ALTER TABLE public.scraping_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scraped_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_accounts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for scraping_sessions
CREATE POLICY "Users can view own sessions"
  ON public.scraping_sessions FOR SELECT
  USING (auth.uid() = created_by);

CREATE POLICY "Users can create own sessions"
  ON public.scraping_sessions FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update own sessions"
  ON public.scraping_sessions FOR UPDATE
  USING (auth.uid() = created_by);

CREATE POLICY "Users can delete own sessions"
  ON public.scraping_sessions FOR DELETE
  USING (auth.uid() = created_by);

-- RLS Policies for scraped_members
CREATE POLICY "Users can view members from own sessions"
  ON public.scraped_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.scraping_sessions
    WHERE id = scraped_members.session_id AND created_by = auth.uid()
  ));

CREATE POLICY "System can insert members"
  ON public.scraped_members FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.scraping_sessions
    WHERE id = scraped_members.session_id AND created_by = auth.uid()
  ));

CREATE POLICY "System can update members"
  ON public.scraped_members FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.scraping_sessions
    WHERE id = scraped_members.session_id AND created_by = auth.uid()
  ));

-- RLS Policies for session_accounts
CREATE POLICY "Users can view accounts from own sessions"
  ON public.session_accounts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.scraping_sessions
    WHERE id = session_accounts.session_id AND created_by = auth.uid()
  ));

CREATE POLICY "Users can manage accounts in own sessions"
  ON public.session_accounts FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.scraping_sessions
    WHERE id = session_accounts.session_id AND created_by = auth.uid()
  ));

-- Trigger for updated_at
CREATE TRIGGER update_scraping_sessions_updated_at
  BEFORE UPDATE ON public.scraping_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_session_accounts_updated_at
  BEFORE UPDATE ON public.session_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable Realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.scraping_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.scraped_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.session_accounts;