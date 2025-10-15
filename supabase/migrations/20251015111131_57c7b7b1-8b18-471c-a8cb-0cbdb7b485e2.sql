-- Fix RLS policies for telegram_accounts and telegram_groups
-- Users should only see their own accounts and groups

-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can view accounts" ON telegram_accounts;
DROP POLICY IF EXISTS "Authenticated users can view groups" ON telegram_groups;

-- Create proper policy for viewing own accounts only
CREATE POLICY "Users can view own accounts" 
ON telegram_accounts 
FOR SELECT 
USING (auth.uid() = created_by);

-- Create security definer function to check account ownership
CREATE OR REPLACE FUNCTION public.user_owns_account(_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.telegram_accounts
    WHERE id = _account_id
      AND created_by = auth.uid()
  )
$$;

-- Create policy for viewing groups from own accounts only
CREATE POLICY "Users can view groups from own accounts"
ON telegram_groups
FOR SELECT
USING (public.user_owns_account(account_id));

-- Update insert policy for groups to check account ownership
DROP POLICY IF EXISTS "Authenticated users can insert groups" ON telegram_groups;
CREATE POLICY "Users can insert groups for own accounts"
ON telegram_groups
FOR INSERT
WITH CHECK (public.user_owns_account(account_id));

-- Update delete policy for groups to check account ownership
DROP POLICY IF EXISTS "Authenticated users can delete groups" ON telegram_groups;
CREATE POLICY "Users can delete groups from own accounts"
ON telegram_groups
FOR DELETE
USING (public.user_owns_account(account_id));