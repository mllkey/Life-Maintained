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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ai_schedule_cache: {
        Row: {
          cache_key: string
          created_at: string | null
          fuel_type: string | null
          id: string
          task_count: number | null
          tasks_json: string
          updated_at: string | null
          vehicle_category: string | null
          vehicle_desc: string | null
        }
        Insert: {
          cache_key: string
          created_at?: string | null
          fuel_type?: string | null
          id?: string
          task_count?: number | null
          tasks_json: string
          updated_at?: string | null
          vehicle_category?: string | null
          vehicle_desc?: string | null
        }
        Update: {
          cache_key?: string
          created_at?: string | null
          fuel_type?: string | null
          id?: string
          task_count?: number | null
          tasks_json?: string
          updated_at?: string | null
          vehicle_category?: string | null
          vehicle_desc?: string | null
        }
        Relationships: []
      }
      budget_notification_tiers: {
        Row: {
          advance_notice_days: number
          advance_notice_label: string
          cost_threshold: number
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          advance_notice_days: number
          advance_notice_label: string
          cost_threshold: number
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          advance_notice_days?: number
          advance_notice_label?: string
          cost_threshold?: number
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      family_members: {
        Row: {
          created_at: string
          date_of_birth: string | null
          id: string
          member_type: string
          name: string
          notes: string | null
          pet_breed: string | null
          pet_type: string | null
          photo_url: string | null
          relationship: string | null
          sex_at_birth: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date_of_birth?: string | null
          id?: string
          member_type?: string
          name: string
          notes?: string | null
          pet_breed?: string | null
          pet_type?: string | null
          photo_url?: string | null
          relationship?: string | null
          sex_at_birth?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date_of_birth?: string | null
          id?: string
          member_type?: string
          name?: string
          notes?: string | null
          pet_breed?: string | null
          pet_type?: string | null
          photo_url?: string | null
          relationship?: string | null
          sex_at_birth?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      health_appointments: {
        Row: {
          appointment_date: string | null
          appointment_type: string
          created_at: string
          estimated_cost: number | null
          family_member_id: string | null
          id: string
          interval_months: number | null
          interval_type: string | null
          is_completed: boolean | null
          last_completed_at: string | null
          next_due_date: string | null
          notes: string | null
          provider_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          appointment_date?: string | null
          appointment_type: string
          created_at?: string
          estimated_cost?: number | null
          family_member_id?: string | null
          id?: string
          interval_months?: number | null
          interval_type?: string | null
          is_completed?: boolean | null
          last_completed_at?: string | null
          next_due_date?: string | null
          notes?: string | null
          provider_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          appointment_date?: string | null
          appointment_type?: string
          created_at?: string
          estimated_cost?: number | null
          family_member_id?: string | null
          id?: string
          interval_months?: number | null
          interval_type?: string | null
          is_completed?: boolean | null
          last_completed_at?: string | null
          next_due_date?: string | null
          notes?: string | null
          provider_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "health_appointments_family_member_id_fkey"
            columns: ["family_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      health_profiles: {
        Row: {
          created_at: string
          date_of_birth: string
          id: string
          sex_at_birth: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date_of_birth: string
          id?: string
          sex_at_birth: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date_of_birth?: string
          id?: string
          sex_at_birth?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      health_records: {
        Row: {
          created_at: string
          date: string | null
          description: string | null
          id: string
          notes: string | null
          provider: string | null
          record_type: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          date?: string | null
          description?: string | null
          id?: string
          notes?: string | null
          provider?: string | null
          record_type: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string | null
          description?: string | null
          id?: string
          notes?: string | null
          provider?: string | null
          record_type?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      interval_corrections: {
        Row: {
          change_method: string
          corrected_interval_miles: number | null
          corrected_interval_months: number | null
          created_at: string | null
          fuel_type: string | null
          id: string
          original_interval_miles: number | null
          original_interval_months: number | null
          schedule_source: string | null
          task_had_completion: boolean | null
          task_key: string | null
          task_name: string
          user_id: string | null
          vehicle_category: string | null
          vehicle_id: string | null
          vehicle_spec: string
        }
        Insert: {
          change_method?: string
          corrected_interval_miles?: number | null
          corrected_interval_months?: number | null
          created_at?: string | null
          fuel_type?: string | null
          id?: string
          original_interval_miles?: number | null
          original_interval_months?: number | null
          schedule_source?: string | null
          task_had_completion?: boolean | null
          task_key?: string | null
          task_name: string
          user_id?: string | null
          vehicle_category?: string | null
          vehicle_id?: string | null
          vehicle_spec: string
        }
        Update: {
          change_method?: string
          corrected_interval_miles?: number | null
          corrected_interval_months?: number | null
          created_at?: string | null
          fuel_type?: string | null
          id?: string
          original_interval_miles?: number | null
          original_interval_months?: number | null
          schedule_source?: string | null
          task_had_completion?: boolean | null
          task_key?: string | null
          task_name?: string
          user_id?: string | null
          vehicle_category?: string | null
          vehicle_id?: string | null
          vehicle_spec?: string
        }
        Relationships: [
          {
            foreignKeyName: "interval_corrections_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_logs: {
        Row: {
          cost: number | null
          created_at: string
          did_it_myself: boolean | null
          hours: number | null
          id: string
          mileage: number | null
          notes: string | null
          property_id: string | null
          provider_contact: string | null
          provider_name: string | null
          receipt_url: string | null
          service_date: string
          service_name: string
          updated_at: string
          user_id: string
          vehicle_id: string | null
          zip_code: string | null
        }
        Insert: {
          cost?: number | null
          created_at?: string
          did_it_myself?: boolean | null
          hours?: number | null
          id?: string
          mileage?: number | null
          notes?: string | null
          property_id?: string | null
          provider_contact?: string | null
          provider_name?: string | null
          receipt_url?: string | null
          service_date: string
          service_name: string
          updated_at?: string
          user_id: string
          vehicle_id?: string | null
          zip_code?: string | null
        }
        Update: {
          cost?: number | null
          created_at?: string
          did_it_myself?: boolean | null
          hours?: number | null
          id?: string
          mileage?: number | null
          notes?: string | null
          property_id?: string | null
          provider_contact?: string | null
          provider_name?: string | null
          receipt_url?: string | null
          service_date?: string
          service_name?: string
          updated_at?: string
          user_id?: string
          vehicle_id?: string | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_logs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_logs_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_templates: {
        Row: {
          category: string
          created_at: string
          description: string | null
          estimated_cost_max: number
          estimated_cost_min: number
          id: string
          make: string
          mileage_interval: number
          model: string
          notes: string | null
          priority: string
          task: string
          time_interval_months: number
          trim_type: string | null
          updated_at: string
          vehicle_type: string
          year_end: number
          year_start: number
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          estimated_cost_max?: number
          estimated_cost_min?: number
          id?: string
          make: string
          mileage_interval: number
          model: string
          notes?: string | null
          priority?: string
          task: string
          time_interval_months: number
          trim_type?: string | null
          updated_at?: string
          vehicle_type?: string
          year_end: number
          year_start: number
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          estimated_cost_max?: number
          estimated_cost_min?: number
          id?: string
          make?: string
          mileage_interval?: number
          model?: string
          notes?: string | null
          priority?: string
          task?: string
          time_interval_months?: number
          trim_type?: string | null
          updated_at?: string
          vehicle_type?: string
          year_end?: number
          year_start?: number
        }
        Relationships: []
      }
      make_template_overrides: {
        Row: {
          created_at: string | null
          id: string
          interval_miles: number | null
          interval_months: number | null
          is_excluded: boolean
          make: string
          notes: string | null
          template_id: string
          year_end: number | null
          year_start: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          interval_miles?: number | null
          interval_months?: number | null
          is_excluded?: boolean
          make: string
          notes?: string | null
          template_id: string
          year_end?: number | null
          year_start?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string
          interval_miles?: number | null
          interval_months?: number | null
          is_excluded?: boolean
          make?: string
          notes?: string | null
          template_id?: string
          year_end?: number | null
          year_start?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "make_template_overrides_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "maintenance_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturer_schedules: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          id: string
          interval: string
          is_manufacturer_data: boolean
          mileage_interval: number | null
          source: string | null
          task: string
          updated_at: string
          user_id: string
          vehicle_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          interval: string
          is_manufacturer_data?: boolean
          mileage_interval?: number | null
          source?: string | null
          task: string
          updated_at?: string
          user_id: string
          vehicle_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          interval?: string
          is_manufacturer_data?: boolean
          mileage_interval?: number | null
          source?: string | null
          task?: string
          updated_at?: string
          user_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manufacturer_schedules_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      medications: {
        Row: {
          created_at: string
          family_member_id: string | null
          id: string
          name: string
          reminder_time: string | null
          reminders_enabled: boolean | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          family_member_id?: string | null
          id?: string
          name: string
          reminder_time?: string | null
          reminders_enabled?: boolean | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          family_member_id?: string | null
          id?: string
          name?: string
          reminder_time?: string | null
          reminders_enabled?: boolean | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "medications_family_member_id_fkey"
            columns: ["family_member_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_analytics: {
        Row: {
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          notification_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          notification_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          notification_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_analytics_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_taken: string | null
          clicked_at: string | null
          created_at: string
          id: string
          is_dismissed: boolean
          is_read: boolean
          link: string | null
          message: string
          priority: Database["public"]["Enums"]["notification_priority"]
          read_at: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          sent_via_email: boolean
          sent_via_push: boolean
          snoozed_until: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          action_taken?: string | null
          clicked_at?: string | null
          created_at?: string
          id?: string
          is_dismissed?: boolean
          is_read?: boolean
          link?: string | null
          message: string
          priority?: Database["public"]["Enums"]["notification_priority"]
          read_at?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          sent_via_email?: boolean
          sent_via_push?: boolean
          snoozed_until?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          action_taken?: string | null
          clicked_at?: string | null
          created_at?: string
          id?: string
          is_dismissed?: boolean
          is_read?: boolean
          link?: string | null
          message?: string
          priority?: Database["public"]["Enums"]["notification_priority"]
          read_at?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          sent_via_email?: boolean
          sent_via_push?: boolean
          snoozed_until?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: []
      }
      phi_audit_log: {
        Row: {
          action: string
          created_at: string
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string
          session_id: string | null
          table_name: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id: string
          session_id?: string | null
          table_name: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string
          session_id?: string | null
          table_name?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          beta_premium_until: string | null
          budget_notifications_enabled: boolean | null
          created_at: string
          email: string | null
          id: string
          is_beta_user: boolean | null
          monthly_scan_count: number
          onboarding_completed: boolean | null
          onboarding_data: Json | null
          onboarding_selections: string[] | null
          onboarding_step: number | null
          push_token: string | null
          revenuecat_customer_id: string | null
          scan_count_reset_at: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_expires_at: string | null
          subscription_renewal_date: string | null
          subscription_start_date: string | null
          subscription_tier: string
          trial_end_date: string | null
          trial_expires_at: string | null
          trial_start_date: string | null
          trial_started_at: string | null
          updated_at: string
          user_id: string
          zip_code: string | null
        }
        Insert: {
          beta_premium_until?: string | null
          budget_notifications_enabled?: boolean | null
          created_at?: string
          email?: string | null
          id?: string
          is_beta_user?: boolean | null
          monthly_scan_count?: number
          onboarding_completed?: boolean | null
          onboarding_data?: Json | null
          onboarding_selections?: string[] | null
          onboarding_step?: number | null
          push_token?: string | null
          revenuecat_customer_id?: string | null
          scan_count_reset_at?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_expires_at?: string | null
          subscription_renewal_date?: string | null
          subscription_start_date?: string | null
          subscription_tier?: string
          trial_end_date?: string | null
          trial_expires_at?: string | null
          trial_start_date?: string | null
          trial_started_at?: string | null
          updated_at?: string
          user_id: string
          zip_code?: string | null
        }
        Update: {
          beta_premium_until?: string | null
          budget_notifications_enabled?: boolean | null
          created_at?: string
          email?: string | null
          id?: string
          is_beta_user?: boolean | null
          monthly_scan_count?: number
          onboarding_completed?: boolean | null
          onboarding_data?: Json | null
          onboarding_selections?: string[] | null
          onboarding_step?: number | null
          push_token?: string | null
          revenuecat_customer_id?: string | null
          scan_count_reset_at?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_expires_at?: string | null
          subscription_renewal_date?: string | null
          subscription_start_date?: string | null
          subscription_tier?: string
          trial_end_date?: string | null
          trial_expires_at?: string | null
          trial_start_date?: string | null
          trial_started_at?: string | null
          updated_at?: string
          user_id?: string
          zip_code?: string | null
        }
        Relationships: []
      }
      promo_codes: {
        Row: {
          code: string
          created_at: string | null
          current_uses: number
          description: string | null
          duration_days: number
          expires_at: string | null
          id: string
          max_uses: number | null
          tier: string
        }
        Insert: {
          code: string
          created_at?: string | null
          current_uses?: number
          description?: string | null
          duration_days?: number
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          tier?: string
        }
        Update: {
          code?: string
          created_at?: string | null
          current_uses?: number
          description?: string | null
          duration_days?: number
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          tier?: string
        }
        Relationships: []
      }
      promo_redemptions: {
        Row: {
          id: string
          promo_code_id: string
          redeemed_at: string
          user_id: string
        }
        Insert: {
          id?: string
          promo_code_id: string
          redeemed_at?: string
          user_id: string
        }
        Update: {
          id?: string
          promo_code_id?: string
          redeemed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_redemptions_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address: string | null
          created_at: string
          id: string
          is_primary_residence: boolean | null
          name: string
          nickname: string | null
          photo_url: string | null
          property_type: string | null
          purchase_date: string | null
          square_feet: number | null
          square_footage: number | null
          updated_at: string
          user_id: string
          year_built: number | null
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          is_primary_residence?: boolean | null
          name: string
          nickname?: string | null
          photo_url?: string | null
          property_type?: string | null
          purchase_date?: string | null
          square_feet?: number | null
          square_footage?: number | null
          updated_at?: string
          user_id: string
          year_built?: number | null
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          is_primary_residence?: boolean | null
          name?: string
          nickname?: string | null
          photo_url?: string | null
          property_type?: string | null
          purchase_date?: string | null
          square_feet?: number | null
          square_footage?: number | null
          updated_at?: string
          user_id?: string
          year_built?: number | null
        }
        Relationships: []
      }
      property_maintenance_tasks: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          estimated_cost: number | null
          id: string
          interval: string | null
          is_completed: boolean | null
          last_completed_at: string | null
          next_due_date: string | null
          notes: string | null
          priority: string
          property_id: string
          service_notes: string | null
          service_type: string | null
          task: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          estimated_cost?: number | null
          id?: string
          interval?: string | null
          is_completed?: boolean | null
          last_completed_at?: string | null
          next_due_date?: string | null
          notes?: string | null
          priority?: string
          property_id: string
          service_notes?: string | null
          service_type?: string | null
          task: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          estimated_cost?: number | null
          id?: string
          interval?: string | null
          is_completed?: boolean | null
          last_completed_at?: string | null
          next_due_date?: string | null
          notes?: string | null
          priority?: string
          property_id?: string
          service_notes?: string | null
          service_type?: string | null
          task?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_maintenance_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_scans: {
        Row: {
          asset_id: string
          asset_type: string
          completed_at: string | null
          created_at: string
          duplicate_hash: string | null
          error_message: string | null
          expires_at: string
          field_confidence: Json | null
          id: string
          image_path: string | null
          normalized_output: Json | null
          raw_ocr_response: Json | null
          request_id: string
          source: string
          status: string
          updated_at: string
          user_confirmed_output: Json | null
          user_id: string
        }
        Insert: {
          asset_id: string
          asset_type: string
          completed_at?: string | null
          created_at?: string
          duplicate_hash?: string | null
          error_message?: string | null
          expires_at?: string
          field_confidence?: Json | null
          id?: string
          image_path?: string | null
          normalized_output?: Json | null
          raw_ocr_response?: Json | null
          request_id: string
          source?: string
          status?: string
          updated_at?: string
          user_confirmed_output?: Json | null
          user_id: string
        }
        Update: {
          asset_id?: string
          asset_type?: string
          completed_at?: string | null
          created_at?: string
          duplicate_hash?: string | null
          error_message?: string | null
          expires_at?: string
          field_confidence?: Json | null
          id?: string
          image_path?: string | null
          normalized_output?: Json | null
          raw_ocr_response?: Json | null
          request_id?: string
          source?: string
          status?: string
          updated_at?: string
          user_confirmed_output?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      referral_leads: {
        Row: {
          booked_date: string | null
          completed_date: string | null
          contact_method: Database["public"]["Enums"]["contact_method"]
          created_at: string
          id: string
          maintenance_task_name: string | null
          maintenance_task_type: string | null
          notes: string | null
          provider_id: string
          provider_response_date: string | null
          quote_amount: number | null
          service_type: Database["public"]["Enums"]["service_type"]
          status: Database["public"]["Enums"]["lead_status"]
          updated_at: string
          user_id: string
          user_zip_code: string | null
        }
        Insert: {
          booked_date?: string | null
          completed_date?: string | null
          contact_method: Database["public"]["Enums"]["contact_method"]
          created_at?: string
          id?: string
          maintenance_task_name?: string | null
          maintenance_task_type?: string | null
          notes?: string | null
          provider_id: string
          provider_response_date?: string | null
          quote_amount?: number | null
          service_type: Database["public"]["Enums"]["service_type"]
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          user_id: string
          user_zip_code?: string | null
        }
        Update: {
          booked_date?: string | null
          completed_date?: string | null
          contact_method?: Database["public"]["Enums"]["contact_method"]
          created_at?: string
          id?: string
          maintenance_task_name?: string | null
          maintenance_task_type?: string | null
          notes?: string | null
          provider_id?: string
          provider_response_date?: string | null
          quote_amount?: number | null
          service_type?: Database["public"]["Enums"]["service_type"]
          status?: Database["public"]["Enums"]["lead_status"]
          updated_at?: string
          user_id?: string
          user_zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "referral_leads_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "service_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      repair_cost_cache: {
        Row: {
          created_at: string | null
          difficulty: number | null
          diy_high: number | null
          diy_low: number | null
          estimated_hours: number | null
          id: string
          parts_list: string | null
          service_name: string
          shop_high: number | null
          shop_low: number | null
          vehicle_key: string
        }
        Insert: {
          created_at?: string | null
          difficulty?: number | null
          diy_high?: number | null
          diy_low?: number | null
          estimated_hours?: number | null
          id?: string
          parts_list?: string | null
          service_name: string
          shop_high?: number | null
          shop_low?: number | null
          vehicle_key: string
        }
        Update: {
          created_at?: string | null
          difficulty?: number | null
          diy_high?: number | null
          diy_low?: number | null
          estimated_hours?: number | null
          id?: string
          parts_list?: string | null
          service_name?: string
          shop_high?: number | null
          shop_low?: number | null
          vehicle_key?: string
        }
        Relationships: []
      }
      service_providers: {
        Row: {
          address: string | null
          business_name: string
          city: string
          created_at: string
          description: string | null
          email: string | null
          id: string
          is_active: boolean | null
          is_example: boolean | null
          is_referral_partner: boolean | null
          is_verified: boolean | null
          logo_url: string | null
          phone: string | null
          price_range_max: number | null
          price_range_min: number | null
          rating: number | null
          referral_fee_amount: number | null
          referral_fee_type: string | null
          review_count: number | null
          service_radius_miles: number | null
          service_types: Database["public"]["Enums"]["service_type"][]
          services_offered: string[] | null
          state: string
          updated_at: string
          website: string | null
          zip_code: string
        }
        Insert: {
          address?: string | null
          business_name: string
          city: string
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          is_example?: boolean | null
          is_referral_partner?: boolean | null
          is_verified?: boolean | null
          logo_url?: string | null
          phone?: string | null
          price_range_max?: number | null
          price_range_min?: number | null
          rating?: number | null
          referral_fee_amount?: number | null
          referral_fee_type?: string | null
          review_count?: number | null
          service_radius_miles?: number | null
          service_types: Database["public"]["Enums"]["service_type"][]
          services_offered?: string[] | null
          state: string
          updated_at?: string
          website?: string | null
          zip_code: string
        }
        Update: {
          address?: string | null
          business_name?: string
          city?: string
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          is_example?: boolean | null
          is_referral_partner?: boolean | null
          is_verified?: boolean | null
          logo_url?: string | null
          phone?: string | null
          price_range_max?: number | null
          price_range_min?: number | null
          rating?: number | null
          referral_fee_amount?: number | null
          referral_fee_type?: string | null
          review_count?: number | null
          service_radius_miles?: number | null
          service_types?: Database["public"]["Enums"]["service_type"][]
          services_offered?: string[] | null
          state?: string
          updated_at?: string
          website?: string | null
          zip_code?: string
        }
        Relationships: []
      }
      subscription_history: {
        Row: {
          created_at: string
          event_type: string
          from_tier: string | null
          id: string
          promo_code_id: string | null
          to_tier: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          from_tier?: string | null
          id?: string
          promo_code_id?: string | null
          to_tier?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          from_tier?: string | null
          id?: string
          promo_code_id?: string | null
          to_tier?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_notification_preferences: {
        Row: {
          advance_warning_days: number
          budget_threshold: number | null
          created_at: string
          digest_frequency: string
          email_enabled: boolean
          id: string
          muted_categories: string[] | null
          muted_properties: string[] | null
          muted_vehicles: string[] | null
          notifications_enabled: boolean
          push_enabled: boolean
          quiet_hours_enabled: boolean
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          sms_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          advance_warning_days?: number
          budget_threshold?: number | null
          created_at?: string
          digest_frequency?: string
          email_enabled?: boolean
          id?: string
          muted_categories?: string[] | null
          muted_properties?: string[] | null
          muted_vehicles?: string[] | null
          notifications_enabled?: boolean
          push_enabled?: boolean
          quiet_hours_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          sms_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          advance_warning_days?: number
          budget_threshold?: number | null
          created_at?: string
          digest_frequency?: string
          email_enabled?: boolean
          id?: string
          muted_categories?: string[] | null
          muted_properties?: string[] | null
          muted_vehicles?: string[] | null
          notifications_enabled?: boolean
          push_enabled?: boolean
          quiet_hours_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          sms_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_owned_tools: {
        Row: {
          created_at: string
          id: string
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_saved_providers: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          provider_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          provider_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          provider_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_saved_providers_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "service_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_service_preferences: {
        Row: {
          category: string | null
          choice_count: number
          created_at: string
          id: string
          preferred_service_type: string
          task_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          choice_count?: number
          created_at?: string
          id?: string
          preferred_service_type?: string
          task_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          choice_count?: number
          created_at?: string
          id?: string
          preferred_service_type?: string
          task_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_vehicle_maintenance_tasks: {
        Row: {
          category: string
          created_at: string | null
          description: string | null
          id: string
          interval_hours: number | null
          interval_miles: number | null
          interval_months: number | null
          is_custom: boolean
          last_completed_date: string | null
          last_completed_hours: number | null
          last_completed_miles: number | null
          name: string
          next_due_date: string | null
          next_due_hours: number | null
          next_due_miles: number | null
          priority: string
          source: string
          status: string
          template_id: string | null
          updated_at: string | null
          user_id: string
          vehicle_id: string
        }
        Insert: {
          category: string
          created_at?: string | null
          description?: string | null
          id?: string
          interval_hours?: number | null
          interval_miles?: number | null
          interval_months?: number | null
          is_custom?: boolean
          last_completed_date?: string | null
          last_completed_hours?: number | null
          last_completed_miles?: number | null
          name: string
          next_due_date?: string | null
          next_due_hours?: number | null
          next_due_miles?: number | null
          priority?: string
          source?: string
          status?: string
          template_id?: string | null
          updated_at?: string | null
          user_id: string
          vehicle_id: string
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          interval_hours?: number | null
          interval_miles?: number | null
          interval_months?: number | null
          is_custom?: boolean
          last_completed_date?: string | null
          last_completed_hours?: number | null
          last_completed_miles?: number | null
          name?: string
          next_due_date?: string | null
          next_due_hours?: number | null
          next_due_miles?: number | null
          priority?: string
          source?: string
          status?: string
          template_id?: string | null
          updated_at?: string | null
          user_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_vehicle_maintenance_tasks_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "maintenance_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_vehicle_maintenance_tasks_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_documents: {
        Row: {
          created_at: string
          document_type: string
          document_url: string
          id: string
          updated_at: string
          user_id: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          document_type: string
          document_url: string
          id?: string
          updated_at?: string
          user_id: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          document_type?: string
          document_url?: string
          id?: string
          updated_at?: string
          user_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_documents_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_maintenance_tasks: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          estimated_cost: number | null
          id: string
          interval: string | null
          is_applicable: boolean | null
          is_completed: boolean | null
          is_customized: boolean | null
          last_completed_at: string | null
          last_service_mileage: number | null
          mileage_interval: number | null
          next_due_date: string | null
          notes: string | null
          priority: string | null
          service_notes: string | null
          service_type: string | null
          task: string
          template_source: string | null
          updated_at: string
          user_id: string
          vehicle_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          estimated_cost?: number | null
          id?: string
          interval?: string | null
          is_applicable?: boolean | null
          is_completed?: boolean | null
          is_customized?: boolean | null
          last_completed_at?: string | null
          last_service_mileage?: number | null
          mileage_interval?: number | null
          next_due_date?: string | null
          notes?: string | null
          priority?: string | null
          service_notes?: string | null
          service_type?: string | null
          task: string
          template_source?: string | null
          updated_at?: string
          user_id: string
          vehicle_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          estimated_cost?: number | null
          id?: string
          interval?: string | null
          is_applicable?: boolean | null
          is_completed?: boolean | null
          is_customized?: boolean | null
          last_completed_at?: string | null
          last_service_mileage?: number | null
          mileage_interval?: number | null
          next_due_date?: string | null
          notes?: string | null
          priority?: string | null
          service_notes?: string | null
          service_type?: string | null
          task?: string
          template_source?: string | null
          updated_at?: string
          user_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_maintenance_tasks_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_mileage_history: {
        Row: {
          created_at: string
          id: string
          mileage: number
          recorded_at: string
          user_id: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mileage: number
          recorded_at?: string
          user_id: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mileage?: number
          recorded_at?: string
          user_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_mileage_history_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_wallet_documents: {
        Row: {
          created_at: string | null
          data: Json
          document_type: string
          id: string
          updated_at: string | null
          user_id: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string | null
          data?: Json
          document_type: string
          id?: string
          updated_at?: string | null
          user_id: string
          vehicle_id: string
        }
        Update: {
          created_at?: string | null
          data?: Json
          document_type?: string
          id?: string
          updated_at?: string | null
          user_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_wallet_documents_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          average_miles_per_month: number | null
          color: string | null
          created_at: string
          engine_cylinders: number | null
          engine_size: string | null
          fuel_type: string
          hours: number | null
          id: string
          is_awd: boolean
          is_seasonal: boolean
          last_mileage_update: string | null
          license_plate: string | null
          make: string
          mileage: number | null
          model: string
          motorcycle_type: string | null
          nickname: string | null
          photo_url: string | null
          season_end_month: number | null
          season_preset: string | null
          season_start_month: number | null
          tracking_mode: string | null
          trim: string | null
          updated_at: string
          user_id: string
          vehicle_category: string
          vehicle_type: string
          vin: string | null
          year: number
        }
        Insert: {
          average_miles_per_month?: number | null
          color?: string | null
          created_at?: string
          engine_cylinders?: number | null
          engine_size?: string | null
          fuel_type?: string
          hours?: number | null
          id?: string
          is_awd?: boolean
          is_seasonal?: boolean
          last_mileage_update?: string | null
          license_plate?: string | null
          make: string
          mileage?: number | null
          model: string
          motorcycle_type?: string | null
          nickname?: string | null
          photo_url?: string | null
          season_end_month?: number | null
          season_preset?: string | null
          season_start_month?: number | null
          tracking_mode?: string | null
          trim?: string | null
          updated_at?: string
          user_id: string
          vehicle_category?: string
          vehicle_type?: string
          vin?: string | null
          year: number
        }
        Update: {
          average_miles_per_month?: number | null
          color?: string | null
          created_at?: string
          engine_cylinders?: number | null
          engine_size?: string | null
          fuel_type?: string
          hours?: number | null
          id?: string
          is_awd?: boolean
          is_seasonal?: boolean
          last_mileage_update?: string | null
          license_plate?: string | null
          make?: string
          mileage?: number | null
          model?: string
          motorcycle_type?: string | null
          nickname?: string | null
          photo_url?: string | null
          season_end_month?: number | null
          season_preset?: string | null
          season_start_month?: number | null
          tracking_mode?: string | null
          trim?: string | null
          updated_at?: string
          user_id?: string
          vehicle_category?: string
          vehicle_type?: string
          vin?: string | null
          year?: number
        }
        Relationships: []
      }
      webhook_events: {
        Row: {
          app_user_id: string | null
          error: string | null
          event_id: string
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          received_at: string
          source: string
          status: string
        }
        Insert: {
          app_user_id?: string | null
          error?: string | null
          event_id: string
          event_type: string
          id?: string
          payload: Json
          processed_at?: string | null
          received_at?: string
          source: string
          status?: string
        }
        Update: {
          app_user_id?: string | null
          error?: string | null
          event_id?: string
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          received_at?: string
          source?: string
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _lm_col_exists: {
        Args: { p_col: string; p_table: string }
        Returns: boolean
      }
      _lm_seed_insert: {
        Args: { p_row: Json; p_table: string }
        Returns: string
      }
      _lm_table_exists: { Args: { p_table: string }; Returns: boolean }
      complete_property_task: {
        Args: {
          p_completed_date?: string
          p_cost?: number
          p_did_it_myself?: boolean
          p_notes?: string
          p_provider_name?: string
          p_task_id: string
        }
        Returns: Json
      }
      complete_receipt_scan: {
        Args: {
          p_duplicate_hash?: string
          p_field_confidence?: Json
          p_image_path?: string
          p_normalized_output: Json
          p_raw_ocr_response?: Json
          p_request_id: string
          p_user_id: string
        }
        Returns: Json
      }
      complete_vehicle_task: {
        Args: {
          p_completed_date?: string
          p_cost?: number
          p_did_it_myself?: boolean
          p_hours?: number
          p_mileage?: number
          p_notes?: string
          p_provider_name?: string
          p_skip_log?: boolean
          p_task_id: string
        }
        Returns: Json
      }
      fail_receipt_scan: {
        Args: {
          p_error_message: string
          p_request_id: string
          p_user_id: string
        }
        Returns: Json
      }
      get_scan_quota: { Args: { p_user_id: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      mark_receipt_scan_processing: {
        Args: { p_request_id: string; p_user_id: string }
        Returns: Json
      }
      reserve_receipt_scan: {
        Args: {
          p_asset_id: string
          p_asset_type: string
          p_request_id: string
          p_source?: string
          p_user_id: string
        }
        Returns: Json
      }
      timeout_stale_scans: { Args: never; Returns: number }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      contact_method: "call" | "email" | "website" | "request_quote"
      lead_status:
        | "sent"
        | "contacted"
        | "quoted"
        | "booked"
        | "completed"
        | "cancelled"
      notification_priority: "low" | "medium" | "high" | "critical"
      notification_type:
        | "maintenance_due"
        | "maintenance_overdue"
        | "budget_alert"
        | "seasonal_reminder"
        | "milestone"
        | "trial_ending"
        | "welcome"
        | "inactive_reminder"
        | "completion"
      service_type:
        | "auto_mechanic"
        | "dentist"
        | "hvac_technician"
        | "plumber"
        | "electrician"
        | "roofer"
        | "veterinarian"
        | "general_contractor"
        | "landscaper"
        | "pest_control"
        | "eye_doctor"
        | "dermatologist"
        | "handyman"
        | "cleaning_service"
        | "other"
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
      app_role: ["admin", "moderator", "user"],
      contact_method: ["call", "email", "website", "request_quote"],
      lead_status: [
        "sent",
        "contacted",
        "quoted",
        "booked",
        "completed",
        "cancelled",
      ],
      notification_priority: ["low", "medium", "high", "critical"],
      notification_type: [
        "maintenance_due",
        "maintenance_overdue",
        "budget_alert",
        "seasonal_reminder",
        "milestone",
        "trial_ending",
        "welcome",
        "inactive_reminder",
        "completion",
      ],
      service_type: [
        "auto_mechanic",
        "dentist",
        "hvac_technician",
        "plumber",
        "electrician",
        "roofer",
        "veterinarian",
        "general_contractor",
        "landscaper",
        "pest_control",
        "eye_doctor",
        "dermatologist",
        "handyman",
        "cleaning_service",
        "other",
      ],
    },
  },
} as const
