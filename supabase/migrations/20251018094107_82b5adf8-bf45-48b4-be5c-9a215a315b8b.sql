-- Ensure users can read their own roles (fix Super Admin visibility)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'user_roles'
  ) THEN
    -- Enable RLS (safe to run multiple times)
    EXECUTE 'ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY';

    -- Drop existing policy if exists
    BEGIN
      EXECUTE 'DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles';
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    -- Create SELECT policy allowing users to read their own roles
    EXECUTE 'CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id)';
  END IF;
END$$;