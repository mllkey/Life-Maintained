-- Migration: create notification_events log table
--
-- Per-user log of every local notification scheduled by the client.
-- Inserted from lib/notificationScheduler.ts after each successful
-- Notifications.scheduleNotificationAsync(...). The Expo identifier
-- returned by that call lives in notif_id and is used by the
-- deep-link listener in app/_layout.tsx to mark response_received_at
-- when the user taps the notification.
--
-- This is the data foundation for PASS-E-005b dormant-user cron and
-- for re-engagement analytics. response_received_at IS NULL combined
-- with scheduled_for < now() - 7d identifies notifications that were
-- shown but not engaged with.
--
-- sent_at is populated at schedule time, not at delivery time. Expo
-- local notifications do not provide a fire callback, and the
-- dormant-user cron does not need delivery-precision.

CREATE TABLE IF NOT EXISTS public.notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notif_id text NOT NULL,
  asset_kind text,
  task_kind text,
  scheduled_for timestamptz,
  sent_at timestamptz DEFAULT now(),
  response_received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_events_user_response_idx
  ON public.notification_events (user_id, response_received_at);

CREATE INDEX IF NOT EXISTS notification_events_notif_id_idx
  ON public.notification_events (notif_id);

ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_events_select_own"
  ON public.notification_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "notification_events_insert_own"
  ON public.notification_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "notification_events_update_own"
  ON public.notification_events FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.notification_events IS
  'Client-inserted log of scheduled local notifications. response_received_at set on user tap. Backs PASS-E-005b dormant-user cron and re-engagement analytics.';
