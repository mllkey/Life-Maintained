# LifeMaintained

A native iOS / cross-platform mobile app built with Expo React Native that tracks vehicle maintenance, home/property maintenance, and health appointments/medications.

## Architecture

- **Frontend**: Expo Router (file-based routing), React Native, TypeScript
- **Backend / Database**: Supabase (existing project — do NOT recreate tables)
- **Auth**: Supabase Auth (email/password)
- **State**: React Query (@tanstack/react-query) for server state, React Context for auth
- **Design**: Dark theme, teal accent (#00C9A7), Inter font family

## Key Files

- `app/_layout.tsx` — Root layout with fonts, auth provider, gesture handler, keyboard controller
- `app/index.tsx` — Root redirect based on auth + onboarding status
- `app/(auth)/` — Login, signup, email verification screens
- `app/(onboarding)/` — 3-step onboarding: category selection, health profile, complete
- `app/(tabs)/` — Main 5-tab layout (Dashboard, Vehicles, Home, Health, Settings)
- `app/(tabs)/index.tsx` — Dashboard with overdue/due-soon items + age-based screenings
- `app/(tabs)/vehicles.tsx` — Vehicle list with status indicators
- `app/(tabs)/home-tab.tsx` — Property list (uses home-tab.tsx to avoid routing conflicts)
- `app/(tabs)/health.tsx` — Health tab with appointments/medications/family sub-tabs
- `app/(tabs)/settings.tsx` — Account settings, health profile, subscription
- `context/AuthContext.tsx` — Auth state + onboarding completion tracking
- `lib/supabase.ts` — Supabase client
- `lib/query-client.ts` — React Query client with default fetcher
- `constants/colors.ts` — Design system color palette

## Modal Screens

- `app/add-vehicle.tsx` — Add a vehicle
- `app/vehicle/[id].tsx` — Vehicle detail with tasks and service history
- `app/log-service/[vehicleId].tsx` — Log service/maintenance with receipt photo
- `app/update-mileage/[vehicleId].tsx` — Quick mileage update
- `app/add-property.tsx` — Add a property
- `app/property/[id].tsx` — Property detail with tasks and service history
- `app/add-property-task/[propertyId].tsx` — Add maintenance task with templates
- `app/add-appointment.tsx` — Add health appointment with interval/family member
- `app/add-medication.tsx` — Add medication with daily reminder time
- `app/add-family-member.tsx` — Add family member or pet
- `app/health-profile.tsx` — Edit health profile (DOB, sex at birth)

## Supabase Tables Used

- `profiles` — User profiles with `onboarding_completed`, `subscription_tier`
- `vehicles` — Vehicle records
- `vehicle_maintenance_tasks` — Maintenance tasks per vehicle
- `vehicle_mileage_history` — Mileage history tracking
- `maintenance_logs` — Service logs (vehicle and property)
- `properties` — Property records
- `property_maintenance_tasks` — Maintenance tasks per property
- `health_profiles` — User health profile (DOB, sex)
- `health_appointments` — Health appointments with intervals
- `medications` — Medications with reminder times
- `family_members` — Family members and pets

## Design Tokens

- Background: `#0B0C10` (near-black)
- Accent: `#00C9A7` (teal)
- Overdue: `#FF453A` (red)
- Due Soon: `#FFD60A` (yellow)
- Good: `#32D74B` (green)
- Vehicle: `#FF9F0A` (orange)
- Home: `#64D2FF` (sky blue)
- Health: `#FF6B9D` (pink)

## Workflows

- **Start Frontend**: `npm run expo:dev` — Expo dev server on port 8081
- **Start Backend**: `npm run server:dev` — Express server on port 5000 (not needed for current features)

## NativeTabs Setup

The tab layout uses `isLiquidGlassAvailable()` from `expo-glass-effect` to check for iOS 26 liquid glass support, falling back to classic BlurView tabs.
