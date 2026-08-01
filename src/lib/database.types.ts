export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: number
          membership_id: string | null
          new_data: Json | null
          previous_data: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: never
          membership_id?: string | null
          new_data?: Json | null
          previous_data?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: never
          membership_id?: string | null
          new_data?: Json | null
          previous_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      benefit_detail_items: {
        Row: {
          benefit_grant_id: string
          created_at: string
          display_order: number
          id: string
          section: Database["public"]["Enums"]["benefit_detail_section"]
          source_type: Database["public"]["Enums"]["benefit_detail_source_type"]
          statement: string
          updated_at: string
        }
        Insert: {
          benefit_grant_id: string
          created_at?: string
          display_order?: number
          id?: string
          section: Database["public"]["Enums"]["benefit_detail_section"]
          source_type: Database["public"]["Enums"]["benefit_detail_source_type"]
          statement: string
          updated_at?: string
        }
        Update: {
          benefit_grant_id?: string
          created_at?: string
          display_order?: number
          id?: string
          section?: Database["public"]["Enums"]["benefit_detail_section"]
          source_type?: Database["public"]["Enums"]["benefit_detail_source_type"]
          statement?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "benefit_detail_items_benefit_grant_id_fkey"
            columns: ["benefit_grant_id"]
            isOneToOne: false
            referencedRelation: "benefit_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefit_detail_items_benefit_grant_id_fkey"
            columns: ["benefit_grant_id"]
            isOneToOne: false
            referencedRelation: "benefit_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      benefit_grant_details: {
        Row: {
          benefit_grant_id: string
          contract_expiration_text: string | null
          contract_quantity_text: string | null
          contract_source_reference: string | null
          cost_model: Database["public"]["Enums"]["benefit_cost_model"] | null
          created_at: string
          discount_percentages: number[] | null
          gold_season_only: boolean | null
          guests_included: number | null
          id: string
          maximum_nights: number | null
          minimum_nights: number | null
          plain_language_summary: string | null
          service_fee_required: boolean | null
          stay_plan: Database["public"]["Enums"]["benefit_stay_plan"] | null
          updated_at: string
        }
        Insert: {
          benefit_grant_id: string
          contract_expiration_text?: string | null
          contract_quantity_text?: string | null
          contract_source_reference?: string | null
          cost_model?: Database["public"]["Enums"]["benefit_cost_model"] | null
          created_at?: string
          discount_percentages?: number[] | null
          gold_season_only?: boolean | null
          guests_included?: number | null
          id?: string
          maximum_nights?: number | null
          minimum_nights?: number | null
          plain_language_summary?: string | null
          service_fee_required?: boolean | null
          stay_plan?: Database["public"]["Enums"]["benefit_stay_plan"] | null
          updated_at?: string
        }
        Update: {
          benefit_grant_id?: string
          contract_expiration_text?: string | null
          contract_quantity_text?: string | null
          contract_source_reference?: string | null
          cost_model?: Database["public"]["Enums"]["benefit_cost_model"] | null
          created_at?: string
          discount_percentages?: number[] | null
          gold_season_only?: boolean | null
          guests_included?: number | null
          id?: string
          maximum_nights?: number | null
          minimum_nights?: number | null
          plain_language_summary?: string | null
          service_fee_required?: boolean | null
          stay_plan?: Database["public"]["Enums"]["benefit_stay_plan"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "benefit_grant_details_benefit_grant_id_fkey"
            columns: ["benefit_grant_id"]
            isOneToOne: true
            referencedRelation: "benefit_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefit_grant_details_benefit_grant_id_fkey"
            columns: ["benefit_grant_id"]
            isOneToOne: true
            referencedRelation: "benefit_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      benefit_grants: {
        Row: {
          archived_at: string | null
          archived_reason: string | null
          benefit_code: string
          created_at: string
          expiration_date: string | null
          id: string
          membership_id: string
          name: string
          original_quantity: number
          pool: Database["public"]["Enums"]["benefit_pool"]
          quantity_kind: Database["public"]["Enums"]["quantity_kind"]
          release_date: string | null
          restrictions: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_reason?: string | null
          benefit_code?: string
          created_at?: string
          expiration_date?: string | null
          id?: string
          membership_id: string
          name: string
          original_quantity: number
          pool: Database["public"]["Enums"]["benefit_pool"]
          quantity_kind: Database["public"]["Enums"]["quantity_kind"]
          release_date?: string | null
          restrictions?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_reason?: string | null
          benefit_code?: string
          created_at?: string
          expiration_date?: string | null
          id?: string
          membership_id?: string
          name?: string
          original_quantity?: number
          pool?: Database["public"]["Enums"]["benefit_pool"]
          quantity_kind?: Database["public"]["Enums"]["quantity_kind"]
          release_date?: string | null
          restrictions?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "benefit_grants_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      benefit_transactions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          benefit_grant_id: string
          created_at: string
          created_by: string | null
          economic_value: number
          face_value: number
          id: string
          membership_id: string
          notes: string | null
          ownership_unit_id: string
          quantity_used: number
          reservation_id: string | null
          status: Database["public"]["Enums"]["transaction_status"]
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          benefit_grant_id: string
          created_at?: string
          created_by?: string | null
          economic_value?: number
          face_value?: number
          id?: string
          membership_id: string
          notes?: string | null
          ownership_unit_id: string
          quantity_used: number
          reservation_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          benefit_grant_id?: string
          created_at?: string
          created_by?: string | null
          economic_value?: number
          face_value?: number
          id?: string
          membership_id?: string
          notes?: string | null
          ownership_unit_id?: string
          quantity_used?: number
          reservation_id?: string | null
          status?: Database["public"]["Enums"]["transaction_status"]
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "benefit_transactions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefit_transactions_benefit_grant_id_fkey"
            columns: ["benefit_grant_id"]
            isOneToOne: false
            referencedRelation: "benefit_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefit_transactions_benefit_grant_id_fkey"
            columns: ["benefit_grant_id"]
            isOneToOne: false
            referencedRelation: "benefit_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefit_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefit_transactions_membership_id_benefit_grant_id_fkey"
            columns: ["membership_id", "benefit_grant_id"]
            isOneToOne: false
            referencedRelation: "benefit_balances"
            referencedColumns: ["membership_id", "id"]
          },
          {
            foreignKeyName: "benefit_transactions_membership_id_benefit_grant_id_fkey"
            columns: ["membership_id", "benefit_grant_id"]
            isOneToOne: false
            referencedRelation: "benefit_grants"
            referencedColumns: ["membership_id", "id"]
          },
          {
            foreignKeyName: "benefit_transactions_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefit_transactions_membership_id_ownership_unit_id_fkey"
            columns: ["membership_id", "ownership_unit_id"]
            isOneToOne: false
            referencedRelation: "ownership_units"
            referencedColumns: ["membership_id", "id"]
          },
          {
            foreignKeyName: "benefit_transactions_membership_id_ownership_unit_id_reser_fkey"
            columns: ["membership_id", "ownership_unit_id", "reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["membership_id", "ownership_unit_id", "id"]
          },
          {
            foreignKeyName: "benefit_transactions_ownership_unit_id_fkey"
            columns: ["ownership_unit_id"]
            isOneToOne: false
            referencedRelation: "ownership_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benefit_transactions_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          archived_at: string | null
          archived_reason: string | null
          contract_number: string
          created_at: string
          expiration_date: string
          id: string
          name: string
          purchase_price: number
          start_date: string
        }
        Insert: {
          archived_at?: string | null
          archived_reason?: string | null
          contract_number: string
          created_at?: string
          expiration_date: string
          id?: string
          name: string
          purchase_price: number
          start_date: string
        }
        Update: {
          archived_at?: string | null
          archived_reason?: string | null
          contract_number?: string
          created_at?: string
          expiration_date?: string
          id?: string
          name?: string
          purchase_price?: number
          start_date?: string
        }
        Relationships: []
      }
      ownership_units: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          members_description: string | null
          membership_id: string
          name: string
          ownership_percentage: number
          participates_in_golf_pool: boolean
          participates_in_shared_pool: boolean
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          members_description?: string | null
          membership_id: string
          name: string
          ownership_percentage: number
          participates_in_golf_pool?: boolean
          participates_in_shared_pool?: boolean
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          members_description?: string | null
          membership_id?: string
          name?: string
          ownership_percentage?: number
          participates_in_golf_pool?: boolean
          participates_in_shared_pool?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ownership_units_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          archived_at: string | null
          archived_reason: string | null
          created_at: string
          date_of_birth: string | null
          display_order: number
          first_name: string
          id: string
          is_active: boolean
          last_name: string
          membership_id: string
          ownership_unit_id: string
          participates_in_golf_pool: boolean
          participates_in_shared_pool: boolean
          person_role: string
          preferred_name: string | null
          profile_id: string | null
          relationship_to_primary: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_reason?: string | null
          created_at?: string
          date_of_birth?: string | null
          display_order?: number
          first_name: string
          id?: string
          is_active?: boolean
          last_name: string
          membership_id: string
          ownership_unit_id: string
          participates_in_golf_pool?: boolean
          participates_in_shared_pool?: boolean
          person_role?: string
          preferred_name?: string | null
          profile_id?: string | null
          relationship_to_primary?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_reason?: string | null
          created_at?: string
          date_of_birth?: string | null
          display_order?: number
          first_name?: string
          id?: string
          is_active?: boolean
          last_name?: string
          membership_id?: string
          ownership_unit_id?: string
          participates_in_golf_pool?: boolean
          participates_in_shared_pool?: boolean
          person_role?: string
          preferred_name?: string | null
          profile_id?: string | null
          relationship_to_primary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_membership_id_ownership_unit_id_fkey"
            columns: ["membership_id", "ownership_unit_id"]
            isOneToOne: false
            referencedRelation: "ownership_units"
            referencedColumns: ["membership_id", "id"]
          },
          {
            foreignKeyName: "people_ownership_unit_id_fkey"
            columns: ["ownership_unit_id"]
            isOneToOne: false
            referencedRelation: "ownership_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          deactivated_at: string | null
          display_name: string | null
          id: string
          is_active: boolean
        }
        Insert: {
          created_at?: string
          deactivated_at?: string | null
          display_name?: string | null
          id: string
          is_active?: boolean
        }
        Update: {
          created_at?: string
          deactivated_at?: string | null
          display_name?: string | null
          id?: string
          is_active?: boolean
        }
        Relationships: []
      }
      reservations: {
        Row: {
          amount_paid: number | null
          check_in: string
          check_out: string
          confirmation_number: string | null
          created_at: string
          created_by: string | null
          id: string
          membership_id: string
          ownership_unit_id: string
          pricing_evidence: string | null
          public_comparable_price: number | null
          resort: string
          room_type: string | null
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount_paid?: number | null
          check_in: string
          check_out: string
          confirmation_number?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          membership_id: string
          ownership_unit_id: string
          pricing_evidence?: string | null
          public_comparable_price?: number | null
          resort: string
          room_type?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount_paid?: number | null
          check_in?: string
          check_out?: string
          confirmation_number?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          membership_id?: string
          ownership_unit_id?: string
          pricing_evidence?: string | null
          public_comparable_price?: number | null
          resort?: string
          room_type?: string | null
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_membership_id_ownership_unit_id_fkey"
            columns: ["membership_id", "ownership_unit_id"]
            isOneToOne: false
            referencedRelation: "ownership_units"
            referencedColumns: ["membership_id", "id"]
          },
          {
            foreignKeyName: "reservations_ownership_unit_id_fkey"
            columns: ["ownership_unit_id"]
            isOneToOne: false
            referencedRelation: "ownership_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      unit_users: {
        Row: {
          granted_at: string
          ownership_unit_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          granted_at?: string
          ownership_unit_id: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          granted_at?: string
          ownership_unit_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "unit_users_ownership_unit_id_fkey"
            columns: ["ownership_unit_id"]
            isOneToOne: false
            referencedRelation: "ownership_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unit_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      benefit_balances: {
        Row: {
          archived_at: string | null
          expiration_date: string | null
          id: string | null
          membership_id: string | null
          name: string | null
          original_quantity: number | null
          pool: Database["public"]["Enums"]["benefit_pool"] | null
          quantity_kind: Database["public"]["Enums"]["quantity_kind"] | null
          release_date: string | null
          remaining_quantity: number | null
          restrictions: string | null
        }
        Relationships: [
          {
            foreignKeyName: "benefit_grants_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      bootstrap_administrator: {
        Args: { p_auth_user_id: string }
        Returns: undefined
      }
      link_profile_to_person: {
        Args: { p_person_id: string; p_profile_id: string }
        Returns: undefined
      }
      numeric_array_within_range: {
        Args: { p_max: number; p_min: number; p_values: number[] }
        Returns: boolean
      }
      reorder_people_within_ownership_unit: {
        Args: { p_ownership_unit_id: string; p_person_ids: string[] }
        Returns: undefined
      }
      user_has_membership_access: {
        Args: { target_membership: string }
        Returns: boolean
      }
      user_is_membership_admin: {
        Args: { target_membership: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "viewer" | "contributor" | "admin"
      benefit_cost_model: "complimentary" | "discounted" | "credit" | "mixed"
      benefit_detail_section:
        | "included"
        | "excluded"
        | "eligible_properties"
        | "season_rules"
        | "occupancy_rules"
        | "fees_and_costs"
        | "redemption_steps"
        | "confirmation_questions"
        | "operational_notes"
      benefit_detail_source_type:
        | "contract"
        | "operational"
        | "inference"
        | "confirm_before_use"
      benefit_pool: "shared" | "golf"
      benefit_stay_plan:
        | "all_inclusive"
        | "european_plan"
        | "property_dependent"
        | "not_applicable"
      quantity_kind: "currency" | "count" | "nights" | "weeks" | "rounds"
      transaction_status: "draft" | "submitted" | "approved" | "voided"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["viewer", "contributor", "admin"],
      benefit_cost_model: ["complimentary", "discounted", "credit", "mixed"],
      benefit_detail_section: [
        "included",
        "excluded",
        "eligible_properties",
        "season_rules",
        "occupancy_rules",
        "fees_and_costs",
        "redemption_steps",
        "confirmation_questions",
        "operational_notes",
      ],
      benefit_detail_source_type: [
        "contract",
        "operational",
        "inference",
        "confirm_before_use",
      ],
      benefit_pool: ["shared", "golf"],
      benefit_stay_plan: [
        "all_inclusive",
        "european_plan",
        "property_dependent",
        "not_applicable",
      ],
      quantity_kind: ["currency", "count", "nights", "weeks", "rounds"],
      transaction_status: ["draft", "submitted", "approved", "voided"],
    },
  },
} as const

