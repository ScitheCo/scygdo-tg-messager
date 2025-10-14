-- Create profiles table for authenticated users
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Create telegram_api_credentials table for API ID and Hash
CREATE TABLE public.telegram_api_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_id TEXT NOT NULL,
  api_hash TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.telegram_api_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view credentials"
  ON public.telegram_api_credentials FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert credentials"
  ON public.telegram_api_credentials FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = created_by);

-- Create telegram_accounts table
CREATE TABLE public.telegram_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL UNIQUE,
  session_string TEXT,
  api_credential_id UUID REFERENCES public.telegram_api_credentials(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.telegram_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view accounts"
  ON public.telegram_accounts FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert accounts"
  ON public.telegram_accounts FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Authenticated users can update accounts"
  ON public.telegram_accounts FOR UPDATE
  TO authenticated USING (auth.uid() = created_by);

CREATE POLICY "Authenticated users can delete accounts"
  ON public.telegram_accounts FOR DELETE
  TO authenticated USING (auth.uid() = created_by);

-- Create telegram_groups table
CREATE TABLE public.telegram_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL,
  title TEXT NOT NULL,
  username TEXT,
  account_id UUID REFERENCES public.telegram_accounts(id) ON DELETE CASCADE,
  is_channel BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(telegram_id, account_id)
);

ALTER TABLE public.telegram_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view groups"
  ON public.telegram_groups FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert groups"
  ON public.telegram_groups FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can delete groups"
  ON public.telegram_groups FOR DELETE
  TO authenticated USING (true);

-- Create message_logs table
CREATE TABLE public.message_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES public.telegram_accounts(id) ON DELETE CASCADE,
  group_id UUID REFERENCES public.telegram_groups(id) ON DELETE CASCADE,
  message_text TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.message_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view logs"
  ON public.message_logs FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert logs"
  ON public.message_logs FOR INSERT
  TO authenticated WITH CHECK (true);

-- Create trigger function for updating timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_telegram_accounts_updated_at
  BEFORE UPDATE ON public.telegram_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger to create profile on user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();