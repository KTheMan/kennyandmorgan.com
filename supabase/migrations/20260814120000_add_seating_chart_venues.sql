-- Seating chart (forked from gabriel1ll7/Seating-Planner, "Seating.Art").
-- Single fixed venue for the wedding. All access goes through the
-- seating-chart-api edge function (service role, admin-session-gated) —
-- never directly from anon/authenticated clients.
create table if not exists public.seating_chart_venues (
    slug text primary key,
    venue_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists seating_chart_venues_set_updated_at on public.seating_chart_venues;
create trigger seating_chart_venues_set_updated_at
before update on public.seating_chart_venues
for each row execute function public.set_updated_at();

alter table public.seating_chart_venues enable row level security;
revoke all on public.seating_chart_venues from anon, authenticated;
