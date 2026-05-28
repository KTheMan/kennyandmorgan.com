create extension if not exists pgcrypto;

-- PR #39: case-insensitive family/party auth and seed format
create or replace function public.login_access(candidate_password text, session_ttl_ms bigint default 3600000)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    matched_level text;
    raw_token text;
begin
    select level
    into matched_level
    from public.access_passwords
    where (
        (level in ('family', 'party') and crypt(lower(coalesce(candidate_password, '')), password_hash) = password_hash)
        or (level = 'admin' and crypt(coalesce(candidate_password, ''), password_hash) = password_hash)
    )
    order by public.access_rank(level) desc
    limit 1;

    if matched_level is null then
        raise exception 'Invalid password.';
    end if;

    raw_token := encode(gen_random_bytes(32), 'hex');

    insert into public.access_sessions (token_hash, access_level, expires_at)
    values (
        encode(digest(raw_token, 'sha256'), 'hex'),
        matched_level,
        timezone('utc', now()) + interval '1 millisecond' * greatest(session_ttl_ms, 60000)
    );

    return jsonb_build_object(
        'success', true,
        'token', raw_token,
        'accessLevel', matched_level,
        'expiresIn', greatest(session_ttl_ms, 60000)
    );
end;
$$;

-- Replace placeholders with your actual passwords before executing this block.
-- Family/party must be lower(...) so mixed-case input still works after hash comparison.
do $$
begin
    if 'family-password-here' = ('family-' || 'password-here')
        or 'party-password-here' = ('party-' || 'password-here')
        or 'admin-password-here' = ('admin-' || 'password-here') then
        raise exception 'Replace family-password-here, party-password-here, and admin-password-here before running this script.';
    end if;
end;
$$;

insert into public.access_passwords (level, password_hash)
values
    ('family', crypt(lower('family-password-here'), gen_salt('bf'))),
    ('party', crypt(lower('party-password-here'), gen_salt('bf'))),
    ('admin', crypt('admin-password-here', gen_salt('bf')))
on conflict (level) do update set password_hash = excluded.password_hash;

-- PR #40: move HMU preferences onto guests and remove legacy submissions table
alter table public.guests
    add column if not exists is_hmu_eligible boolean not null default false,
    add column if not exists hmu_selection text not null default 'not_selected';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'guests_hmu_selection_check'
    ) then
        alter table public.guests
            add constraint guests_hmu_selection_check
            check (hmu_selection in ('not_selected', 'hair', 'makeup', 'hair_makeup', 'opt_out'));
    end if;
end;
$$;

drop function if exists public.list_admin_hmu_submissions(text);
drop table if exists public.hmu_submissions;

create or replace function public.save_hmu_submission(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    normalized_name text := trim(coalesce(payload->>'fullName', ''));
    normalized_email text := nullif(trim(coalesce(payload->>'email', '')), '');
    wants_hair boolean := coalesce((payload->>'wantsHair')::boolean, false);
    wants_makeup boolean := coalesce((payload->>'wantsMakeup')::boolean, false);
    wants_opt_out boolean := coalesce((payload->>'wantsOptOut')::boolean, false);
    normalized_selection text := case
        when wants_opt_out then 'opt_out'
        when wants_hair and wants_makeup then 'hair_makeup'
        when wants_hair then 'hair'
        when wants_makeup then 'makeup'
        else 'not_selected'
    end;
    matching_guest_id bigint;
    is_eligible boolean := false;
    matching_count integer := 0;
begin
    if normalized_name = '' then
        raise exception 'Name is required.';
    end if;

    if normalized_selection = 'not_selected' then
        raise exception 'Please choose Hair, Makeup, or Opt-out.';
    end if;

    select count(*)
    into matching_count
    from public.guests g
    where lower(trim(g.full_name)) = lower(normalized_name)
      and (
            normalized_email is null
            or lower(coalesce(g.email, '')) = lower(normalized_email)
      );

    if matching_count > 1 and normalized_email is null then
        raise exception 'Multiple guests match that name. Please include the RSVP email.';
    end if;

    select g.id, g.is_hmu_eligible
    into matching_guest_id, is_eligible
    from public.guests g
    where lower(trim(g.full_name)) = lower(normalized_name)
      and (
            normalized_email is null
            or lower(coalesce(g.email, '')) = lower(normalized_email)
      )
    order by (case when normalized_email is not null and lower(coalesce(g.email, '')) = lower(normalized_email) then 0 else 1 end), g.id
    limit 1;

    if matching_guest_id is null then
        raise exception 'We could not match that name/email to a guest. Please use the exact RSVP details.';
    end if;

    if not is_eligible then
        raise exception 'This guest is not marked as eligible for hair and makeup.';
    end if;

    update public.guests
    set hmu_selection = normalized_selection,
        email = coalesce(normalized_email, email),
        updated_at = timezone('utc', now())
    where id = matching_guest_id;

    return jsonb_build_object('success', true, 'message', 'Thanks! We will reach out to confirm.');
end;
$$;

grant execute on function public.save_hmu_submission(jsonb) to anon, authenticated;

-- PR #40/#41: rehearsal lunch guest flag + RSVP table/functions
alter table public.guests
    add column if not exists is_invited_to_rehearsal_lunch boolean not null default false;

create table if not exists public.rehearsal_lunch_rsvps (
    id bigint generated by default as identity primary key,
    full_name text not null,
    email text,
    rsvp_status text not null default 'accepted' check (rsvp_status in ('accepted', 'declined')),
    submitted_at timestamptz not null default timezone('utc', now())
);

revoke all on public.rehearsal_lunch_rsvps from anon, authenticated;

create or replace function public.submit_rehearsal_lunch_rsvp(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if trim(coalesce(payload->>'fullName', '')) = '' then
        raise exception 'Name is required.';
    end if;

    insert into public.rehearsal_lunch_rsvps (full_name, email, rsvp_status)
    values (
        trim(payload->>'fullName'),
        nullif(trim(coalesce(payload->>'email', '')), ''),
        coalesce(nullif(trim(coalesce(payload->>'rsvpStatus', '')), ''), 'accepted')
    );

    return jsonb_build_object('success', true, 'message', 'Got it! Thanks for your RSVP.');
end;
$$;

create or replace function public.list_admin_rehearsal_lunch_rsvps(session_token text)
returns jsonb
language sql
security definer
set search_path = public
as $$
    with authorized as (
        select public.require_session(session_token, 'admin')
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id,
        'fullName', r.full_name,
        'email', r.email,
        'rsvpStatus', r.rsvp_status,
        'submittedAt', r.submitted_at
    ) order by r.submitted_at desc), '[]'::jsonb)
    from public.rehearsal_lunch_rsvps r, authorized;
$$;

grant execute on function public.submit_rehearsal_lunch_rsvp(jsonb) to anon, authenticated;
grant execute on function public.list_admin_rehearsal_lunch_rsvps(text) to anon, authenticated;

-- PR #41 guest backfill
update public.guests
set is_invited_to_rehearsal_lunch = true,
    is_hmu_eligible = true,
    updated_at = timezone('utc', now())
where lower(trim(full_name)) = 'alyssa graham';
