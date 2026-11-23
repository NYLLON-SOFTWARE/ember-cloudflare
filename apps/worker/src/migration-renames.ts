/**
 * What this fork's deploys numbered the workspace's and rooms' own migrations by before it numbered
 * them as it does now, each with the file that holds what it made today. A storage or database that
 * ran one under an old name keeps the tables it made, and the record of it moves with them: renamed
 * before the check of what to apply, it applies no migration twice. Two of the numbers say content
 * that a file of today has changed since, which the runner of the Workspace's migrations makes up for:
 * `0066_profile_fields.sql` kept its times as numbers of milliseconds, which the columns take either
 * way, and `0067_reminders.sql` kept no reminder's thread, whose column the runner adds.
 */
export const MIGRATION_RENAMES: readonly (readonly [was: string, now: string])[] = [
  ["0057_pins.sql", "0080_pins.sql"],
  ["0063_pins.sql", "0080_pins.sql"],
  ["0058_user_groups.sql", "0081_user_groups.sql"],
  ["0064_user_groups.sql", "0081_user_groups.sql"],
  ["0059_dnd.sql", "0082_dnd.sql"],
  ["0065_dnd.sql", "0082_dnd.sql"],
  ["0060_profile_fields.sql", "0083_profile_fields.sql"],
  ["0066_profile_fields.sql", "0083_profile_fields.sql"],
  ["0061_reminders.sql", "0084_reminders.sql"],
  ["0067_reminders.sql", "0084_reminders.sql"],
  ["0073_reminder_push_retries.sql", "0085_reminder_push_retries.sql"],
  ["0068_reminder_push_retries.sql", "0085_reminder_push_retries.sql"],
  ["0062_statuses.sql", "0086_statuses.sql"],
  ["0069_statuses.sql", "0086_statuses.sql"],
  ["0063_saves.sql", "0087_saves.sql"],
  ["0070_saves.sql", "0087_saves.sql"],
  ["0064_guests.sql", "0088_guests.sql"],
  ["0071_guests.sql", "0088_guests.sql"],
  ["0065_commands.sql", "0089_commands.sql"],
  ["0072_commands.sql", "0089_commands.sql"],
  ["0062_reminder_pushes.sql", "0090_reminder_pushes.sql"],
  ["0072_reminder_pushes.sql", "0090_reminder_pushes.sql"],
  ["0074_reminder_pushes.sql", "0090_reminder_pushes.sql"],
  ["0075_shortcuts.sql", "0091_shortcuts.sql"],
  ["0063_usernames.sql", "0072_usernames.sql"],
  ["0071_reports.sql", "0073_reports.sql"],
  ["0073_bot_rooms.sql", "0077_bot_rooms.sql"],
  ["0077_cleared_reports.sql", "0078_cleared_reports.sql"],
  ["0066_tokens.sql", "0073_tokens.sql"],
];
