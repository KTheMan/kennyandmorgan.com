-- Add registry_url column to track which registry source each item came from.
-- This enables source-aware sync: items from different registries can coexist,
-- and stale items are only deleted per-source.
alter table public.registry_items
    add column if not exists registry_url text;
