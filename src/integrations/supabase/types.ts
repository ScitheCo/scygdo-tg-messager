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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      user_owns_account: {
        Args: { _account_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
