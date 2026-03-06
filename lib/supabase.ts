import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          user_id: string;
          subscription_tier: string | null;
          trial_started_at: string | null;
          trial_expires_at: string | null;
          subscription_expires_at: string | null;
          revenuecat_customer_id: string | null;
          push_token: string | null;
          monthly_scan_count: number;
          scan_count_reset_at: string | null;
          onboarding_completed: boolean | null;
          created_at: string | null;
          updated_at: string | null;
        };
      };
      vehicles: {
        Row: {
          id: string;
          user_id: string;
          year: number | null;
          make: string | null;
          model: string | null;
          trim: string | null;
          vehicle_type: string | null;
          vehicle_category: string | null;
          motorcycle_type: string | null;
          mileage: number | null;
          is_seasonal: boolean | null;
          average_miles_per_month: number | null;
          created_at: string | null;
          updated_at: string | null;
          nickname: string | null;
          color: string | null;
          vin: string | null;
          license_plate: string | null;
        };
      };
      vehicle_maintenance_tasks: {
        Row: {
          id: string;
          vehicle_id: string;
          task: string;
          interval: number | null;
          mileage_interval: number | null;
          next_due_date: string | null;
          last_completed_at: string | null;
          last_service_mileage: number | null;
          priority: string | null;
          estimated_cost: number | null;
          created_at: string | null;
          updated_at: string | null;
        };
      };
      vehicle_mileage_history: {
        Row: {
          id: string;
          vehicle_id: string;
          mileage: number;
          recorded_at: string;
          created_at: string | null;
        };
      };
      maintenance_logs: {
        Row: {
          id: string;
          vehicle_id: string | null;
          property_id: string | null;
          task: string | null;
          date: string | null;
          mileage: number | null;
          cost: number | null;
          provider: string | null;
          notes: string | null;
          receipt_url: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
      };
      properties: {
        Row: {
          id: string;
          user_id: string;
          address: string | null;
          property_type: string | null;
          year_built: number | null;
          square_footage: number | null;
          nickname: string | null;
          is_primary_residence: boolean | null;
          created_at: string | null;
          updated_at: string | null;
        };
      };
      property_maintenance_tasks: {
        Row: {
          id: string;
          user_id: string;
          property_id: string;
          task: string;
          description: string | null;
          category: string | null;
          interval: string | null;
          estimated_cost: number | null;
          is_completed: boolean | null;
          last_completed_at: string | null;
          next_due_date: string | null;
          notes: string | null;
          service_type: string | null;
          service_notes: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
      };
      health_profiles: {
        Row: {
          id: string;
          user_id: string;
          date_of_birth: string | null;
          sex_at_birth: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
      };
      health_appointments: {
        Row: {
          id: string;
          user_id: string;
          family_member_id: string | null;
          appointment_type: string;
          provider_name: string | null;
          interval_months: number | null;
          next_due_date: string | null;
          last_completed_at: string | null;
          notes: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
      };
      family_members: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          relationship: string | null;
          member_type: string | null;
          pet_type: string | null;
          date_of_birth: string | null;
          created_at: string | null;
          updated_at: string | null;
        };
      };
      medications: {
        Row: {
          id: string;
          user_id: string;
          family_member_id: string | null;
          name: string;
          reminder_time: string | null;
          reminders_enabled: boolean | null;
          created_at: string | null;
          updated_at: string | null;
        };
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          body: string | null;
          type: string | null;
          priority: string | null;
          read: boolean | null;
          created_at: string | null;
        };
      };
      user_notification_preferences: {
        Row: {
          id: string;
          user_id: string;
          push_enabled: boolean | null;
          quiet_hours_start: string | null;
          quiet_hours_end: string | null;
          advance_warning_days: number | null;
          muted_categories: string[] | null;
          muted_vehicles: string[] | null;
          muted_properties: string[] | null;
          created_at: string | null;
          updated_at: string | null;
        };
      };
    };
  };
};
