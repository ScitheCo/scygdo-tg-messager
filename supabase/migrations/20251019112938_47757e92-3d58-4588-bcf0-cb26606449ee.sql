-- Allow Super Admins to view all accounts
CREATE POLICY "Super admins can view all accounts"
ON public.telegram_accounts
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'Super Admin'::app_role));