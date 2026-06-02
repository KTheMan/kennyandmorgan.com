-- PR #43: fix admin eligibility field save + gate rehearsal-lunch search by invite status
--
-- Assumes PR #39 (case-insensitive login) and PR #40/#41 (is_hmu_eligible,
-- is_invited_to_rehearsal_lunch columns, rehearsal_lunch_rsvps table, and
-- related functions) have already been applied.
--
-- This file only patches the three functions that were missing is_child and
-- the new eligibility fields, and ensures the three required columns exist.

-- Ensure columns exist (idempotent)
alter table public.guests
    add column if not exists is_child boolean not null default false,
    add column if not exists is_hmu_eligible boolean not null default false,
    add column if not exists is_invited_to_rehearsal_lunch boolean not null default false;

-- list_admin_guests: return all guest fields including new eligibility flags
create or replace function public.list_admin_guests(session_token text)
returns jsonb
language sql
security definer
set search_path = public
as $$
    with authorized as (
        select public.require_session(session_token, 'admin')
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', guest.id,
        'fullName', guest.full_name,
        'email', guest.email,
        'groupId', guest.group_id,
        'isPrimary', guest.is_primary,
        'isPlusOne', guest.is_plus_one,
        'isChild', guest.is_child,
        'isHmuEligible', guest.is_hmu_eligible,
        'hmuSelection', guest.hmu_selection,
        'notes', guest.notes,
        'rsvpStatus', guest.rsvp_status,
        'mealChoice', guest.meal_choice,
        'dietaryNotes', guest.dietary_notes,
        'addressLine1', guest.address_line1,
        'addressLine2', guest.address_line2,
        'city', guest.city,
        'state', guest.state,
        'postalCode', guest.postal_code,
        'rsvpSubmitterName', latest_rsvp.submitter_name,
        'rsvpSubmitterEmail', latest_rsvp.submitter_email,
        'rsvpSpecialMessage', latest_rsvp.special_message,
        'rsvpSongRequest', latest_rsvp.song_request,
        'rsvpSubmittedAt', latest_rsvp.created_at,
        'lastRsvpAt', guest.last_rsvp_at,
        'isInvitedToRehearsalLunch', guest.is_invited_to_rehearsal_lunch
    ) order by guest.group_id, guest.is_primary desc, guest.full_name asc), '[]'::jsonb)
    from public.guests guest
    cross join authorized
    left join lateral (
        select
            r.submitter_name,
            r.submitter_email,
            r.special_message,
            r.song_request,
            r.created_at
        from public.rsvp_submissions r
        where r.group_id = guest.group_id
        order by r.created_at desc, r.id desc
        limit 1
    ) latest_rsvp on true;
$$;

-- admin_upsert_guest: persist all fields including is_child and eligibility flags
create or replace function public.admin_upsert_guest(session_token text, guest_id bigint, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    saved_id bigint;
begin
    perform public.require_session(session_token, 'admin');

    if trim(coalesce(payload->>'fullName', '')) = '' or trim(coalesce(payload->>'groupId', '')) = '' then
        raise exception 'fullName and groupId are required.';
    end if;

    if guest_id is null then
        insert into public.guests (
            full_name,
            email,
            group_id,
            is_primary,
            is_plus_one,
            is_child,
            is_hmu_eligible,
            notes,
            rsvp_status,
            hmu_selection,
            meal_choice,
            dietary_notes,
            address_line1,
            address_line2,
            city,
            state,
            postal_code,
            is_invited_to_rehearsal_lunch
        ) values (
            trim(payload->>'fullName'),
            nullif(trim(coalesce(payload->>'email', '')), ''),
            trim(payload->>'groupId'),
            coalesce((payload->>'isPrimary')::boolean, false),
            coalesce((payload->>'isPlusOne')::boolean, false),
            coalesce((payload->>'isChild')::boolean, false),
            coalesce((payload->>'isHmuEligible')::boolean, false),
            nullif(trim(coalesce(payload->>'notes', '')), ''),
            coalesce(nullif(trim(coalesce(payload->>'rsvpStatus', '')), ''), 'pending'),
            coalesce(nullif(trim(coalesce(payload->>'hmuSelection', '')), ''), 'not_selected'),
            nullif(trim(coalesce(payload->>'mealChoice', '')), ''),
            nullif(trim(coalesce(payload->>'dietaryNotes', '')), ''),
            nullif(trim(coalesce(payload->>'addressLine1', '')), ''),
            nullif(trim(coalesce(payload->>'addressLine2', '')), ''),
            nullif(trim(coalesce(payload->>'city', '')), ''),
            nullif(trim(coalesce(payload->>'state', '')), ''),
            nullif(trim(coalesce(payload->>'postalCode', '')), ''),
            coalesce((payload->>'isInvitedToRehearsalLunch')::boolean, false)
        ) returning id into saved_id;
    else
        update public.guests
        set full_name = trim(payload->>'fullName'),
            email = nullif(trim(coalesce(payload->>'email', '')), ''),
            group_id = trim(payload->>'groupId'),
            is_primary = coalesce((payload->>'isPrimary')::boolean, false),
            is_plus_one = coalesce((payload->>'isPlusOne')::boolean, false),
            is_child = coalesce((payload->>'isChild')::boolean, false),
            is_hmu_eligible = coalesce((payload->>'isHmuEligible')::boolean, false),
            notes = nullif(trim(coalesce(payload->>'notes', '')), ''),
            rsvp_status = coalesce(nullif(trim(coalesce(payload->>'rsvpStatus', '')), ''), 'pending'),
            hmu_selection = coalesce(nullif(trim(coalesce(payload->>'hmuSelection', '')), ''), 'not_selected'),
            meal_choice = nullif(trim(coalesce(payload->>'mealChoice', '')), ''),
            dietary_notes = nullif(trim(coalesce(payload->>'dietaryNotes', '')), ''),
            address_line1 = nullif(trim(coalesce(payload->>'addressLine1', '')), ''),
            address_line2 = nullif(trim(coalesce(payload->>'addressLine2', '')), ''),
            city = nullif(trim(coalesce(payload->>'city', '')), ''),
            state = nullif(trim(coalesce(payload->>'state', '')), ''),
            postal_code = nullif(trim(coalesce(payload->>'postalCode', '')), ''),
            is_invited_to_rehearsal_lunch = coalesce((payload->>'isInvitedToRehearsalLunch')::boolean, false),
            updated_at = timezone('utc', now())
        where id = guest_id
        returning id into saved_id;

        if saved_id is null then
            raise exception 'Guest not found.';
        end if;
    end if;

    return jsonb_build_object('success', true, 'id', saved_id);
end;
$$;

-- search_guest_groups: drop old 2-arg overload and recreate with rehearsal eligibility filter
drop function if exists public.search_guest_groups(text, integer);

create or replace function public.search_guest_groups(
    search_name text,
    max_results integer default 5,
    require_rehearsal_eligible boolean default false
)
returns jsonb
language sql
security definer
set search_path = public
as $$
with tokens as (
    select regexp_split_to_array(trim(coalesce(search_name, '')), '\s+') as parts
), filtered as (
    select g.*
    from public.guests g, tokens t
    where cardinality(t.parts) >= 2
      and lower(g.full_name) like '%' || lower(t.parts[1]) || '%'
      and lower(g.full_name) like '%' || lower(t.parts[cardinality(t.parts)]) || '%'
      and (not require_rehearsal_eligible or g.is_invited_to_rehearsal_lunch = true)
), grouped as (
    select distinct group_id
    from filtered
    order by group_id
    limit greatest(coalesce(max_results, 5), 1)
)
select coalesce(jsonb_agg(
    jsonb_build_object(
        'groupId', grp.group_id,
        'primaryGuest', coalesce((
            select full_name
            from public.guests
            where group_id = grp.group_id
              and (not require_rehearsal_eligible or is_invited_to_rehearsal_lunch = true)
            order by is_primary desc, full_name asc
            limit 1
        ), ''),
        'guests', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', guest.id,
                'fullName', guest.full_name,
                'email', guest.email,
                'isPrimary', guest.is_primary,
                'isPlusOne', guest.is_plus_one,
                'isChild', guest.is_child,
                'isHmuEligible', guest.is_hmu_eligible,
                'isInvitedToRehearsalLunch', guest.is_invited_to_rehearsal_lunch,
                'hmuSelection', guest.hmu_selection,
                'notes', guest.notes,
                'rsvpStatus', guest.rsvp_status,
                'mealChoice', guest.meal_choice,
                'dietaryNotes', guest.dietary_notes,
                'addressLine1', guest.address_line1,
                'addressLine2', guest.address_line2,
                'city', guest.city,
                'state', guest.state,
                'postalCode', guest.postal_code
            ) order by guest.is_primary desc, guest.full_name asc)
            from public.guests guest
            where guest.group_id = grp.group_id
              and (not require_rehearsal_eligible or guest.is_invited_to_rehearsal_lunch = true)
        ), '[]'::jsonb)
    )
), '[]'::jsonb)
from grouped grp;
$$;

grant execute on function public.list_admin_guests(text) to anon, authenticated;
grant execute on function public.admin_upsert_guest(text, bigint, jsonb) to anon, authenticated;
grant execute on function public.search_guest_groups(text, integer, boolean) to anon, authenticated;
