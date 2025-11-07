export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      account_daily_limits: {
        Row: {
          account_id: string
          date: string
          id: string
          last_used_at: string | null
          members_added_today: number | null
        }
        Insert: {
          account_id: string
          date?: string
          id?: string
          last_used_at?: string | null
          members_added_today?: number | null
        }
        Update: {
          account_id?: string
          date?: string
          id?: string
          last_used_at?: string | null
          members_added_today?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "account_daily_limits_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "telegram_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      authorized_bot_users: {
        Row: {
          added_by: string | null
          created_at: string
          id: string
          is_active: boolean
          telegram_username: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          telegram_username: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          telegram_username?: string
        }
        Relationships: []
      }
      bot_conversation_states: {
        Row: {
          chat_id: number
          created_at: string
          current_step: string
          custom_emojis: string[] | null
          group_link: string | null
          id: string
          post_link: string | null
          task_type: string | null
          telegram_user_id: number
          updated_at: string
        }
        Insert: {
          chat_id: number
          created_at?: string
          current_step: string
          custom_emojis?: string[] | null
          group_link?: string | null
          id?: string
          post_link?: string | null
          task_type?: string | null
          telegram_user_id: number
          updated_at?: string
        }
        Update: {
          chat_id?: number
          created_at?: string
          current_step?: string
          custom_emojis?: string[] | null
          group_link?: string | null
          id?: string
          post_link?: string | null
          task_type?: string | null
          telegram_user_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      emoji_task_logs: {
        Row: {
          account_id: string
          action_type: string
          created_at: string
          emoji_used: string | null
          error_message: string | null
          id: string
          status: string
          task_id: string
        }
        Insert: {
          account_id: string
          action_type: string
          created_at?: string
          emoji_used?: string | null
          error_message?: string | null
          id?: string
          status: string
          task_id: string
        }
        Update: {
          account_id?: string
          action_type?: string
          created_at?: string
          emoji_used?: string | null
          error_message?: string | null
          id?: string
          status?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "emoji_task_logs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "telegram_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emoji_task_logs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "emoji_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      emoji_tasks: {
        Row: {
          available_count: number
          chat_id: number
          completed_at: string | null
          created_at: string
          custom_emojis: string[] | null
          error_message: string | null
          group_id: number | null
          group_link: string
          id: string
          message_id: number | null
          post_link: string
          queue_number: number
          requested_count: number
          started_at: string | null
          status: string
          task_type: string
          telegram_user_id: number
          telegram_username: string
          total_failed: number
          total_success: number
        }
        Insert: {
          available_count: number
          chat_id: number
          completed_at?: string | null
          created_at?: string
          custom_emojis?: string[] | null
          error_message?: string | null
          group_id?: number | null
          group_link: string
          id?: string
          message_id?: number | null
          post_link: string
          queue_number: number
          requested_count: number
          started_at?: string | null
          status?: string
          task_type: string
          telegram_user_id: number
          telegram_username: string
          total_failed?: number
          total_success?: number
        }
        Update: {
          available_count?: number
          chat_id?: number
          completed_at?: string | null
          created_at?: string
          custom_emojis?: string[] | null
          error_message?: string | null
          group_id?: number | null
          group_link?: string
          id?: string
          message_id?: number | null
          post_link?: string
          queue_number?: number
          requested_count?: number
          started_at?: string | null
          status?: string
          task_type?: string
          telegram_user_id?: number
          telegram_username?: string
          total_failed?: number
          total_success?: number
        }
        Relationships: []
      }
      member_scraping_logs: {
        Row: {
          account_id: string | null
          created_at: string | null
          created_by: string | null
          details: Json | null
          error_message: string | null
          id: string
          members_added: number | null
          source_group_id: string | null
          source_group_title: string | null
          status: string
          target_group_id: string | null
          target_group_title: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string | null
          created_by?: string | null
          details?: Json | null
          error_message?: string | null
          id?: string
          members_added?: number | null
          source_group_id?: string | null
          source_group_title?: string | null
          status: string
          target_group_id?: string | null
          target_group_title?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string | null
          created_by?: string | null
          details?: Json | null
          error_message?: string | null
          id?: string
          members_added?: number | null
          source_group_id?: string | null
          source_group_title?: string | null
          status?: string
          target_group_id?: string | null
          target_group_title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_scraping_logs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "telegram_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_scraping_logs_source_group_id_fkey"
            columns: ["source_group_id"]
            isOneToOne: false
            referencedRelation: "telegram_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_scraping_logs_target_group_id_fkey"
            columns: ["target_group_id"]
            isOneToOne: false
            referencedRelation: "telegram_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      message_logs: {
        Row: {
          account_id: string | null
          created_at: string
          error_message: string | null
          group_id: string | null
          id: string
          message_text: string
          status: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          error_message?: string | null
          group_id?: string | null
          id?: string
          message_text: string
          status: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          error_message?: string | null
          group_id?: string | null
          id?: string
          message_text?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_logs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "telegram_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_logs_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "telegram_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      scraped_members: {
        Row: {
          access_hash: number | null
          created_at: string
          id: string
          is_admin: boolean
          is_bot: boolean
          processed_by_account_id: string | null
          sequence_number: number
          session_id: string
          status: string
          user_id: number
        }
        Insert: {
          access_hash?: number | null
          created_at?: string
          id?: string
          is_admin?: boolean
          is_bot?: boolean
          processed_by_account_id?: string | null
          sequence_number: number
          session_id: string
          status?: string
          user_id: number
        }
        Update: {
          access_hash?: number | null
          created_at?: string
          id?: string
          is_admin?: boolean
          is_bot?: boolean
          processed_by_account_id?: string | null
          sequence_number?: number
          session_id?: string
          status?: string
          user_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "scraped_members_processed_by_account_id_fkey"
            columns: ["processed_by_account_id"]
            isOneToOne: false
            referencedRelation: "telegram_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scraped_members_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "scraping_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      scraping_sessions: {
        Row: {
          created_at: string
          created_by: string | null
          error_message: string | null
          fetched_at: string | null
          id: string
          settings: Json
          source_group_id: number | null
          source_group_input: string
          source_group_title: string | null
          status: string
          target_group_id: number | null
          target_group_input: string
          target_group_title: string | null
          total_failed: number
          total_filtered_out: number
          total_in_queue: number
          total_members_fetched: number
          total_processed: number
          total_success: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          fetched_at?: string | null
          id?: string
          settings?: Json
          source_group_id?: number | null
          source_group_input: string
          source_group_title?: string | null
          status?: string
          target_group_id?: number | null
          target_group_input: string
          target_group_title?: string | null
          total_failed?: number
          total_filtered_out?: number
          total_in_queue?: number
          total_members_fetched?: number
          total_processed?: number
          total_success?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          fetched_at?: string | null
          id?: string
          settings?: Json
          source_group_id?: number | null
          source_group_input?: string
          source_group_title?: string | null
          status?: string
          target_group_id?: number | null
          target_group_input?: string
          target_group_title?: string | null
          total_failed?: number
          total_filtered_out?: number
          total_in_queue?: number
          total_members_fetched?: number
          total_processed?: number
          total_success?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scraping_sessions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      session_accounts: {
        Row: {
          account_id: string
          added_today: number
          created_at: string
          flood_wait_until: string | null
          id: string
          is_active: boolean
          last_activity_at: string | null
          session_id: string
          total_attempts: number
          total_success: number
          updated_at: string
        }
        Insert: {
          account_id: string
          added_today?: number
          created_at?: string
          flood_wait_until?: string | null
          id?: string
          is_active?: boolean
          last_activity_at?: string | null
          session_id: string
          total_attempts?: number
          total_success?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          added_today?: number
          created_at?: string
          flood_wait_until?: string | null
          id?: string
          is_active?: boolean
          last_activity_at?: string | null
          session_id?: string
          total_attempts?: number
          total_success?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_accounts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "telegram_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_accounts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "scraping_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_accounts: {
        Row: {
          api_credential_id: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean | null
          name: string | null
          phone_number: string
          session_string: string | null
          updated_at: string
        }
        Insert: {
          api_credential_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          phone_number: string
          session_string?: string | null
          updated_at?: string
        }
        Update: {
          api_credential_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          phone_number?: string
          session_string?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_accounts_api_credential_id_fkey"
            columns: ["api_credential_id"]
            isOneToOne: false
            referencedRelation: "telegram_api_credentials"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_api_credentials: {
        Row: {
          api_hash: string
          api_id: string
          created_at: string
          created_by: string | null
          id: string
        }
        Insert: {
          api_hash: string
          api_id: string
          created_at?: string
          created_by?: string | null
          id?: string
        }
        Update: {
          api_hash?: string
          api_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
        }
        Relationships: []
      }
      telegram_groups: {
        Row: {
          account_id: string | null
          created_at: string
          id: string
          is_channel: boolean | null
          telegram_id: number
          title: string
          username: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          id?: string
          is_channel?: boolean | null
          telegram_id: number
          title: string
          username?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          id?: string
          is_channel?: boolean | null
          telegram_id?: number
          title?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_groups_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "telegram_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      worker_heartbeats: {
        Row: {
          created_at: string
          details: Json | null
          id: string
          last_seen: string
          status: string
          version: string | null
          worker_id: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          id?: string
          last_seen?: string
          status?: string
          version?: string | null
          worker_id: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          id?: string
          last_seen?: string
          status?: string
          version?: string | null
          worker_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      user_owns_account: { Args: { _account_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "Standart" | "Super Admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["Standart", "Super Admin"],
    },
  },
} as const
