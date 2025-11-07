-- Create authorized_bot_users table
CREATE TABLE IF NOT EXISTS public.authorized_bot_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_username text UNIQUE NOT NULL,
  added_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);

-- Create emoji_tasks table
CREATE TABLE IF NOT EXISTS public.emoji_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id bigint NOT NULL,
  telegram_username text NOT NULL,
  chat_id bigint NOT NULL,
  group_link text NOT NULL,
  post_link text NOT NULL,
  group_id bigint,
  message_id integer,
  task_type text NOT NULL CHECK (task_type IN ('positive_emoji', 'negative_emoji', 'view_only', 'custom_emoji')),
  custom_emojis text[],
  requested_count integer NOT NULL,
  available_count integer NOT NULL,
  queue_number integer NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  total_success integer NOT NULL DEFAULT 0,
  total_failed integer NOT NULL DEFAULT 0,
  error_message text
);

-- Create emoji_task_logs table
CREATE TABLE IF NOT EXISTS public.emoji_task_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.emoji_tasks(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.telegram_accounts(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN ('emoji_reaction', 'view_message')),
  emoji_used text,
  status text NOT NULL CHECK (status IN ('success', 'failed', 'rate_limited')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create bot_conversation_states table
CREATE TABLE IF NOT EXISTS public.bot_conversation_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id bigint UNIQUE NOT NULL,
  chat_id bigint NOT NULL,
  current_step text NOT NULL CHECK (current_step IN ('group_link', 'post_link', 'preset', 'custom_emojis', 'count', 'idle')),
  group_link text,
  post_link text,
  task_type text,
  custom_emojis text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_emoji_tasks_status ON public.emoji_tasks(status);
CREATE INDEX IF NOT EXISTS idx_emoji_tasks_queue ON public.emoji_tasks(queue_number) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_emoji_task_logs_task_id ON public.emoji_task_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_bot_conversation_states_user_id ON public.bot_conversation_states(telegram_user_id);

-- Enable RLS
ALTER TABLE public.authorized_bot_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emoji_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emoji_task_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_conversation_states ENABLE ROW LEVEL SECURITY;

-- RLS Policies for authorized_bot_users
CREATE POLICY "Super admins can manage authorized users"
  ON public.authorized_bot_users
  FOR ALL
  USING (has_role(auth.uid(), 'Super Admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'Super Admin'::app_role));

-- RLS Policies for emoji_tasks
CREATE POLICY "Super admins can view all tasks"
  ON public.emoji_tasks
  FOR SELECT
  USING (has_role(auth.uid(), 'Super Admin'::app_role));

CREATE POLICY "Service role can manage tasks"
  ON public.emoji_tasks
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- RLS Policies for emoji_task_logs
CREATE POLICY "Super admins can view all logs"
  ON public.emoji_task_logs
  FOR SELECT
  USING (has_role(auth.uid(), 'Super Admin'::app_role));

CREATE POLICY "Service role can manage logs"
  ON public.emoji_task_logs
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- RLS Policies for bot_conversation_states
CREATE POLICY "Service role can manage conversation states"
  ON public.bot_conversation_states
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create trigger for updated_at
CREATE TRIGGER update_bot_conversation_states_updated_at
  BEFORE UPDATE ON public.bot_conversation_states
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for emoji_tasks and emoji_task_logs
ALTER TABLE public.emoji_tasks REPLICA IDENTITY FULL;
ALTER TABLE public.emoji_task_logs REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.emoji_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.emoji_task_logs;