-- Fix message_logs RLS to only show logs for user's own accounts
DROP POLICY IF EXISTS "Authenticated users can view logs" ON public.message_logs;

CREATE POLICY "Users can view logs from own accounts" ON public.message_logs
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.telegram_accounts
    WHERE telegram_accounts.id = message_logs.account_id
    AND telegram_accounts.created_by = auth.uid()
  )
);

-- Super admins can delete scraping logs
CREATE POLICY "Super admins can delete scraping logs" ON public.member_scraping_logs 
FOR DELETE USING (public.has_role(auth.uid(), 'Super Admin'));

-- Users can delete message logs from own accounts
CREATE POLICY "Users can delete own message logs" ON public.message_logs
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.telegram_accounts
    WHERE telegram_accounts.id = message_logs.account_id
    AND telegram_accounts.created_by = auth.uid()
  )
);