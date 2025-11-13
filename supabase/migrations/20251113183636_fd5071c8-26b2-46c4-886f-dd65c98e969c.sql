-- Create account_health_status table
CREATE TABLE public.account_health_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.telegram_accounts(id) ON DELETE CASCADE,
  last_checked timestamp with time zone,
  status text NOT NULL,
  error_message text,
  consecutive_failures integer DEFAULT 0 NOT NULL,
  last_success timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE(account_id)
);

-- Enable RLS
ALTER TABLE public.account_health_status ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their account health"
  ON public.account_health_status FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.telegram_accounts
      WHERE telegram_accounts.id = account_health_status.account_id
        AND telegram_accounts.created_by = auth.uid()
    )
  );

CREATE POLICY "Super admins can view all health records"
  ON public.account_health_status FOR SELECT
  USING (public.has_role(auth.uid(), 'Super Admin'::app_role));

CREATE POLICY "Service role can manage all health records"
  ON public.account_health_status FOR ALL
  USING (true)
  WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_account_health_status_updated_at
  BEFORE UPDATE ON public.account_health_status
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes for performance
CREATE INDEX idx_account_health_status_account_id ON public.account_health_status(account_id);
CREATE INDEX idx_account_health_status_status ON public.account_health_status(status);
CREATE INDEX idx_account_health_status_last_checked ON public.account_health_status(last_checked);