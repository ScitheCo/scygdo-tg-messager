-- 1. Fix telegram_api_credentials RLS - her kullanıcı sadece kendi API bilgilerini görebilir
DROP POLICY IF EXISTS "Authenticated users can view credentials" ON telegram_api_credentials;
CREATE POLICY "Users can view own credentials" ON telegram_api_credentials 
FOR SELECT USING (auth.uid() = created_by);

-- 2. Create role system - Kullanıcı rolleri için enum ve tablo
CREATE TYPE public.app_role AS ENUM ('Standart', 'Super Admin');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function - Rol kontrolü için güvenli fonksiyon
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- RLS policies for user_roles
CREATE POLICY "Users can view own roles" ON public.user_roles 
FOR SELECT USING (auth.uid() = user_id);

-- 3. Assign default "Standart" role to all existing users
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'Standart'::app_role
FROM auth.users
ON CONFLICT (user_id, role) DO NOTHING;

-- 4. Assign "Super Admin" to specific user
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'Super Admin'::app_role
FROM auth.users
WHERE email = 'scithecompany@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- 5. Create trigger to auto-assign "Standart" role to new users
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'Standart'::app_role);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_assign_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_role();

-- 6. Create table for member scraping logs
CREATE TABLE public.member_scraping_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES telegram_accounts(id) ON DELETE CASCADE,
  source_group_id UUID REFERENCES telegram_groups(id) ON DELETE SET NULL,
  target_group_id UUID REFERENCES telegram_groups(id) ON DELETE SET NULL,
  source_group_title TEXT,
  target_group_title TEXT,
  members_added INTEGER DEFAULT 0,
  status TEXT NOT NULL,
  error_message TEXT,
  details JSONB
);

ALTER TABLE public.member_scraping_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can view all scraping logs" ON public.member_scraping_logs 
FOR SELECT USING (public.has_role(auth.uid(), 'Super Admin'));

CREATE POLICY "Super admins can insert scraping logs" ON public.member_scraping_logs 
FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'Super Admin'));

-- 7. Create table to track daily account usage for member adding
CREATE TABLE public.account_daily_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES telegram_accounts(id) ON DELETE CASCADE NOT NULL,
  date DATE DEFAULT CURRENT_DATE NOT NULL,
  members_added_today INTEGER DEFAULT 0,
  last_used_at TIMESTAMP WITH TIME ZONE,
  UNIQUE (account_id, date)
);

ALTER TABLE public.account_daily_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can manage daily limits" ON public.account_daily_limits 
FOR ALL USING (public.has_role(auth.uid(), 'Super Admin'));