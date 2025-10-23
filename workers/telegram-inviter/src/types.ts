export interface ScrapingSession {
  id: string;
  status: string;
  source_group_input: string;
  target_group_input: string;
  target_group_id?: string;
  target_group_title?: string;
  settings: SessionSettings;
  total_in_queue: number;
  total_processed: number;
  total_success: number;
  total_failed: number;
  error_message?: string;
  created_by: string;
}

export interface SessionSettings {
  daily_limit: number;
  invite_delay: number;
  batch_delay: number;
  filter_bots?: boolean;
  filter_admins?: boolean;
}

export interface SessionAccount {
  id: string;
  session_id: string;
  account_id: string;
  is_active: boolean;
  added_today: number;
  total_attempts: number;
  total_success: number;
  flood_wait_until?: string;
  last_activity_at?: string;
  telegram_accounts: TelegramAccount;
}

export interface TelegramAccount {
  id: string;
  phone_number: string;
  name?: string;
  session_string?: string;
  api_credential_id: string;
  telegram_api_credentials: ApiCredentials;
}

export interface ApiCredentials {
  api_id: string;
  api_hash: string;
}

export interface ScrapedMember {
  id: string;
  session_id: string;
  sequence_number: number;
  user_id: string;
  access_hash?: string;
  is_bot: boolean;
  is_admin: boolean;
  status: 'queued' | 'processing' | 'success' | 'failed';
  processed_by_account_id?: string;
}

export interface AccountDailyLimit {
  account_id: string;
  date: string;
  members_added_today: number;
  last_used_at?: string;
}

export interface MemberScrapingLog {
  account_id: string;
  status: string;
  error_message?: string;
  details?: any;
}

export const PERMANENT_ERRORS = [
  'CHAT_ADMIN_REQUIRED',
  'USER_PRIVACY_RESTRICTED',
  'USER_ID_INVALID',
  'USER_BOT',
  'PEER_FLOOD',
  'CHANNEL_PRIVATE',
  'INVITE_REQUEST_SENT',
  'USER_RESTRICTED',
  'USER_KICKED',
  'USER_BANNED_IN_CHANNEL',
  'USER_NOT_MUTUAL_CONTACT',
  'USER_CHANNELS_TOO_MUCH',
  'CHANNELS_TOO_MUCH'
];
