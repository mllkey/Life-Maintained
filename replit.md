# LifeMaintained

A native iOS / cross-platform mobile app built with Expo React Native that tracks vehicle maintenance, home/property maintenance, and health appointments/medications.

## Architecture

- **Frontend**: Expo Router (file-based routing), React Native, TypeScript
- **Backend / Database**: Supabase (existing project — do NOT recreate tables)
- **Auth**: Supabase Auth (email/password)
- **State**: React Query (@tanstack/react-query) for server state, React Context for auth
- **Design**: Dark theme, teal accent (#00C9A7), Inter font family
- **Server**: Express on port 5000 — serves OCR endpoint and static Expo files

## Key Files

- `app/_layout.tsx` — Root layout with fonts, auth provider, gesture handler, keyboard controller
- `app/index.tsx` — Root redirect based on auth + onboarding status
- `app/(auth)/` — Login, signup, email verification, forgot-password screens
- `app/(onboarding)/` — 3-step onboarding: category selection, health profile, complete
- `app/(tabs)/` — Main 5-tab layout (Dashboard, Vehicles, Home, Health, Settings)
- `app/(tabs)/index.tsx` — Dashboard: overdue/due-soon items + age-based screenings with notification opt-in toggles
- `app/(tabs)/vehicles.tsx` — Vehicle list with status indicators
- `app/(tabs)/home-tab.tsx` — Property list (uses home-tab.tsx to avoid routing conflicts)
- `app/(tabs)/health.tsx` — Health tab: appointments/medications/family; push notification scheduling for medications
- `app/(tabs)/settings.tsx` — Account settings, subscription, legal, notifications, account deletion
- `context/AuthContext.tsx` — Auth state + onboarding completion tracking
- `lib/supabase.ts` — Supabase client
- `lib/query-client.ts` — React Query client with default fetcher
- `constants/colors.ts` — Design system color palette
- `server/routes.ts` — Express routes (OCR removed; receipt scanning is handled via Supabase Edge Function)
- `lib/receiptScanner.ts` — Calls `scan-receipt` Supabase Edge Function with base64 image; returns structured result
- `supabase/functions/scan-receipt/index.ts` — Deno Edge Function: calls Anthropic claude-3-5-haiku-20241022 vision API to extract date/cost/provider/serviceType from receipt image; requires `ANTHROPIC_API_KEY` Supabase secret
- `components/ReceiptScanButton.tsx` — Self-contained receipt scan button (camera or gallery); calls receiptScanner and fires onScanComplete callback

## Screens

- `app/add-vehicle.tsx` — Add a vehicle (avg miles/month conditionally required by type)
- `app/vehicle/[id].tsx` — Vehicle detail: tasks tab + service history tab (summary bar, grouped tappable cards)
- `app/vehicle-task-history/[vehicleId].tsx` — Vehicle service type drill-down: expandable log rows, receipt modal, Edit/Delete
- `app/log-service/[vehicleId].tsx` — Log service with receipt OCR + cross-asset pricing insight banner
- `app/update-mileage/[vehicleId].tsx` — Quick mileage update
- `app/add-property.tsx` — Add a property (builds default tasks on save)
- `app/add-property-task/[propertyId].tsx` — Add maintenance task with templates
- `app/property/[id].tsx` — Property detail: tasks tab + service history tab (same grouped design as vehicle)
- `app/property-task-history/[propertyId].tsx` — Property service type drill-down: expandable log rows, receipt modal, Delete
- `app/family-member/[id].tsx` — Family member/pet detail: appointments grouped by type with status + Medications tab
- `app/add-appointment.tsx` — Add health appointment with interval/family member
- `app/add-medication.tsx` — Add medication with daily reminder time
- `app/add-family-member.tsx` — Add family member or pet
- `app/health-profile.tsx` — Edit health profile (DOB, sex at birth)
- `app/subscription.tsx` — Subscription paywall: Free vs Premium, trial countdown, promo code
- `app/notifications-settings.tsx` — Push toggle, advance days, quiet hours, per-vehicle/property mute, budget alerts
- `app/terms-of-service.tsx` — Full Terms of Service in-app page
- `app/privacy-policy.tsx` — Full Privacy Policy in-app page

## Supabase Tables Used

- `profiles` — User profiles: `onboarding_completed`, `subscription_tier`, `trial_end_date`, `stripe_customer_id`
- `vehicles` — Vehicle records with `average_miles_per_month`
- `vehicle_maintenance_tasks` — Maintenance tasks per vehicle
- `vehicle_mileage_history` — Mileage history tracking
- `maintenance_logs` — Service logs (vehicle and property)
- `properties` — Property records
- `property_maintenance_tasks` — Maintenance tasks per property (auto-calculates next due date)
- `health_profiles` — User health profile (DOB, sex)
- `health_appointments` — Health appointments with intervals
- `medications` — Medications with reminder times for push notification scheduling
- `family_members` — Family members and pets
- `budget_notification_tiers` — Per-user budget alert thresholds

## Supabase Storage

- `receipts` bucket — Private bucket for receipt photos. RLS enforced: users can only read/write/delete files under their own `user_id` path prefix. Policies: `receipts_insert_own`, `receipts_select_own`, `receipts_delete_own`. File path: `{user_id}/vehicle/{vehicle_id}/{timestamp}.jpg` or `{user_id}/property/{property_id}/{timestamp}.jpg`. Provisioned via `scripts/setup-receipts-bucket.ts`.

## Features

- **Auth**: Login, signup, email verify, forgot password
- **Onboarding**: 3-step category + health profile setup
- **Dashboard**: Overdue/due-soon alerts, age-based health screenings with per-screening notification opt-in bell icons
- **Vehicles**: Add/view vehicles, log service, update mileage, maintenance task completion
- **Home**: Add/view properties, add tasks with templates, task completion with next-due auto-calculation
- **Health**: Appointments, medications (with push notification scheduling), family members/pets
- **Subscription**: Free vs Premium UI, 14-day trial, promo code input, connected to profiles table
- **Notifications**: Push permissions, advance warning days (7/14/30), quiet hours, per-vehicle/property mute, budget alerts via budget_notification_tiers table
- **Export**: PDF (expo-print) and CSV (expo-file-system) export of vehicle service history for resale
- **Receipt OCR**: ReceiptScanButton (camera or gallery) → Supabase Edge Function `scan-receipt` → auto-fills date, cost, provider, service type in the log form
- **Receipt Storage**: Scanned receipt photos uploaded to Supabase Storage `receipts` bucket (private, RLS-protected). Path: `{user_id}/vehicle/{vehicle_id}/{timestamp}.jpg`. Stored path saved to `maintenance_logs.receipt_url`. History screens generate 1-hour signed URLs on tap to show receipt in full-screen pinch-to-zoom modal. Upload failure shows warning but never blocks save.
- **Settings**: Health profile, notifications, subscription management, Terms of Service, Privacy Policy, account deletion, email branding note

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
- **Start Backend**: `npm run server:dev` — Express server on port 5000

## Packages Added

- `expo-notifications@~0.32.16` — Push notifications for medication reminders + screening opt-ins
- `expo-print@~15.0.8` — PDF generation for service history export
- `expo-sharing@~14.0.8` — Share PDFs and CSVs via native share sheet
- `expo-file-system@~19.0.21` — File read/write for CSV export and OCR base64 encoding
- `expo-image-picker@~16.0.6` — Camera and gallery picker used inside ReceiptScanButton

## NativeTabs Setup

The tab layout uses `isLiquidGlassAvailable()` from `expo-glass-effect` to check for iOS 26 liquid glass support, falling back to classic BlurView tabs.

## Important Notes

- Tab file is `home-tab.tsx` (not `home.tsx`) to avoid Expo Router routing conflicts
- `average_miles_per_month` is conditionally shown/required for mileage-tracked vehicle types only
- Property task completion auto-calculates next due date using interval string (Monthly/Quarterly/etc.)
- OCR endpoint at `POST /api/ocr` accepts `{ image: base64string }`, returns `{ date, cost, service, provider }`
- Notification preferences stored in AsyncStorage under key `notification_prefs`
- Health screening opt-ins stored in AsyncStorage under key `screening_notif_optins`

## Wallet Tab (vehicle/[id].tsx)

Three wallet cards per vehicle: Registration (blue), Insurance (green), Driver's License (amber).

**Add/Edit forms** — `WalletFormSheet` bottom sheet modal:
- Registration: State (picker), Plate, Reg # (secure), Expiration (stepper), Owner
- Insurance: Provider, Policy # (secure), Group # (optional/secure), Coverage Type (segmented: Liability/Full/Comprehensive), Expiration (stepper), Agent, Agent Phone, Claims Phone
- Driver's License: Name, License # (secure), State (picker), Class, Expiration (stepper), DOB (stepper/secure)
- Save: upsert to `vehicle_wallet_documents` with `onConflict: "vehicle_id,document_type"`
- Edit mode shows red "Delete Document" button → confirmation Alert → delete row
- State picker via `StatePickerModal` — separate full-height modal with scrollable US state list

**Copy-from-vehicle flow** (add-vehicle.tsx):
- `useQuery` pre-fetches other vehicles with insurance/registration docs while user fills the form
- If candidates exist when Save is tapped: saves vehicle synchronously, then shows `CopyFromVehicleModal`
- Modal lists candidate vehicles; tapping one copies insurance + registration docs (never id_card) to new vehicle
- "Skip" or backdrop tap dismisses and navigates back; no-candidates case preserves instant-nav behavior

## Subscription Enforcement

Tier limits enforced across the entire app via `lib/subscription.ts` helpers:
- **Add screens** (`add-vehicle`, `add-property`, `add-family-member`): check tier limit before save; shows `Paywall` modal when limit reached
- **List screens** (`vehicles`, `home-tab`, `health`): items beyond tier limit show dimmed lock overlay; tapping shows Alert with "Upgrade Now"; action buttons hidden for locked items
- **Log service** (`log-service/[vehicleId]`): free tier → Paywall; 0 scans → ScanPackModal; ≤5 scans → warning badge on ReceiptScanButton
- **Export** (`vehicle/[id]`): gated behind `hasPersonalOrAbove`; free/trial-expired users see Paywall modal
- **Settings subscription banner**: shows correct tier/trial status using `isInTrial`, `isFreeTier`, `trialDaysRemaining`, `hasBusiness`, `hasProOrAbove`; Manage button opens Apple subscriptions on iOS; `TrialBanner` shows only when in trial with ≤7 days remaining
