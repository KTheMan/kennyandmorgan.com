# Archived Supabase Migrations

These migration files were squashed into the production baseline migration:

- `20260529080000_split_registry_images.sql`
- `20260603000000_fix_rsvp_song_special_fields.sql`
- `20260604000000_fix_rsvp_special_message_fallback.sql`
- `20260604053000_restore_menu_items_and_require_plus_one_names.sql`

They are kept for audit/history only. Do not move them back into
`supabase/migrations` unless you intentionally want the Supabase CLI to consider
them deployable again.
