alter table public.registry_items
  add column if not exists registry_image_url text,
  add column if not exists resolved_image_url text,
  add column if not exists image_marked_for_retry boolean not null default false,
  add column if not exists image_manually_cleared boolean not null default false,
  add column if not exists image_blacklisted boolean not null default false,
  add column if not exists image_suspicious boolean not null default false,
  add column if not exists image_low_confidence boolean not null default false;

update public.registry_items
set registry_image_url = coalesce(registry_image_url, image_url)
where registry_image_url is null;

update public.registry_items
set image_url = coalesce(resolved_image_url, registry_image_url, image_url);
