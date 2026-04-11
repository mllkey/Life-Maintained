-- Backfill user_notification_preferences rows for all existing users who don't have one.
-- push_enabled defaults to false; no budget_threshold set.
INSERT INTO user_notification_preferences (user_id, push_enabled, created_at, updated_at)
SELECT p.user_id, false, now(), now()
FROM profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM user_notification_preferences unp WHERE unp.user_id = p.user_id
)
ON CONFLICT (user_id) DO NOTHING;
