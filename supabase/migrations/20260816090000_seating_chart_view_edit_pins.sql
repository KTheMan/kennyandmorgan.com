-- Seating chart: split the single PIN into an edit PIN (as before,
-- always on) and an optional, toggleable view PIN. When a venue's
-- view_pin_required is off (the default — same as before this
-- migration), viewing stays open to anyone with the link. When it's on,
-- viewing also requires the view PIN (or the edit PIN, or admin —
-- editing always implies viewing).

alter table public.seating_chart_venues
    rename column hashed_pin to hashed_edit_pin;

alter table public.seating_chart_venues
    add column if not exists hashed_view_pin text,
    add column if not exists view_pin_required boolean not null default false;

-- Track which PIN (view vs edit) an attempt was against, so exhausting
-- one doesn't lock out the other.
alter table public.seating_chart_pin_attempts
    add column if not exists pin_kind text not null default 'edit';

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'seating_chart_pin_attempts_pin_kind_check'
    ) then
        alter table public.seating_chart_pin_attempts
            add constraint seating_chart_pin_attempts_pin_kind_check
            check (pin_kind in ('view', 'edit'));
    end if;
end;
$$;

drop index if exists seating_chart_pin_attempts_lookup_idx;
create index if not exists seating_chart_pin_attempts_lookup_idx
    on public.seating_chart_pin_attempts (slug, pin_kind, ip_hash, attempted_at);

drop function if exists public.seating_chart_record_pin_attempt(text, text);
create or replace function public.seating_chart_record_pin_attempt(
    target_slug text,
    pin_kind text,
    client_ip text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    hashed_ip text := encode(digest(coalesce(client_ip, 'unknown'), 'sha256'), 'hex');
    recent_attempts integer;
begin
    delete from public.seating_chart_pin_attempts
    where attempted_at <= timezone('utc', now()) - interval '15 minutes';

    select count(*)
    into recent_attempts
    from public.seating_chart_pin_attempts
    where slug = target_slug
      and pin_kind = seating_chart_record_pin_attempt.pin_kind
      and ip_hash = hashed_ip
      and attempted_at > timezone('utc', now()) - interval '15 minutes';

    if recent_attempts >= 10 then
        raise exception 'Too many PIN attempts for this chart. Try again in a few minutes.';
    end if;

    insert into public.seating_chart_pin_attempts (slug, pin_kind, ip_hash)
    values (target_slug, pin_kind, hashed_ip);
end;
$$;

drop function if exists public.seating_chart_check_pin(text, text, text);
create or replace function public.seating_chart_check_pin(
    target_slug text,
    pin_kind text,
    candidate_pin text,
    client_ip text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    stored_hash text;
begin
    if pin_kind not in ('view', 'edit') then
        raise exception 'Invalid pin_kind.';
    end if;

    perform public.seating_chart_record_pin_attempt(target_slug, pin_kind, client_ip);

    select case pin_kind when 'view' then hashed_view_pin else hashed_edit_pin end
    into stored_hash
    from public.seating_chart_venues
    where slug = target_slug;

    if stored_hash is null or candidate_pin is null or candidate_pin = '' then
        return false;
    end if;

    return crypt(candidate_pin, stored_hash) = stored_hash;
end;
$$;

create or replace function public.seating_chart_list_venues(session_token text)
returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
    with authorized as (select public.require_session(session_token, 'admin'))
    select coalesce(jsonb_agg(jsonb_build_object(
        'slug', v.slug,
        'eventTitle', coalesce(v.venue_data->>'eventTitle', 'Untitled Event'),
        'updatedAt', v.updated_at,
        'hasEditPin', v.hashed_edit_pin is not null,
        'hasViewPin', v.hashed_view_pin is not null,
        'viewPinRequired', v.view_pin_required
    ) order by v.updated_at desc), '[]'::jsonb)
    from public.seating_chart_venues v, authorized;
$$;

-- Public (no session required): fetch a venue by slug. Editing always
-- implies viewing, so a valid edit_pin (or admin) satisfies a view-pin
-- requirement too. Returns a locked payload (no venue_data) when a view
-- PIN is required and neither admin, edit_pin, nor view_pin checks out.
-- Returns null if the slug doesn't exist at all.
drop function if exists public.seating_chart_get_venue(text);
create or replace function public.seating_chart_get_venue(
    target_slug text,
    session_token text default null,
    view_pin text default null,
    edit_pin text default null,
    client_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    row_data record;
    is_admin boolean := false;
    unlocked boolean := false;
begin
    select v.venue_data, v.updated_at, v.hashed_edit_pin, v.hashed_view_pin, v.view_pin_required
    into row_data
    from public.seating_chart_venues v
    where v.slug = target_slug;

    if not found then
        return null;
    end if;

    if session_token is not null and session_token <> '' then
        begin
            perform public.require_session(session_token, 'admin');
            is_admin := true;
        exception when others then
            is_admin := false;
        end;
    end if;

    if is_admin or not row_data.view_pin_required then
        unlocked := true;
    elsif edit_pin is not null and edit_pin <> ''
        and public.seating_chart_check_pin(target_slug, 'edit', edit_pin, client_ip) then
        unlocked := true;
    elsif view_pin is not null and view_pin <> ''
        and public.seating_chart_check_pin(target_slug, 'view', view_pin, client_ip) then
        unlocked := true;
    end if;

    if not unlocked then
        return jsonb_build_object(
            'slug', target_slug,
            'locked', true,
            'viewPinRequired', true,
            'hasEditPin', row_data.hashed_edit_pin is not null,
            'hasViewPin', row_data.hashed_view_pin is not null
        );
    end if;

    return jsonb_build_object(
        'slug', target_slug,
        'locked', false,
        'venueData', row_data.venue_data,
        'updatedAt', row_data.updated_at,
        'hasEditPin', row_data.hashed_edit_pin is not null,
        'hasViewPin', row_data.hashed_view_pin is not null,
        'viewPinRequired', row_data.view_pin_required
    );
end;
$$;

-- Save a venue's state. Allowed if session_token proves admin, OR
-- candidate_pin matches that venue's edit PIN (rate-limited).
drop function if exists public.seating_chart_save_venue(text, text, jsonb, text, text);
create or replace function public.seating_chart_save_venue(
    session_token text,
    target_slug text,
    new_venue_data jsonb,
    candidate_edit_pin text default null,
    client_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    is_admin boolean := false;
    updated timestamptz;
begin
    if session_token is not null and session_token <> '' then
        begin
            perform public.require_session(session_token, 'admin');
            is_admin := true;
        exception when others then
            is_admin := false;
        end;
    end if;

    if not is_admin then
        if candidate_edit_pin is null or candidate_edit_pin = '' then
            raise exception 'Unauthorized';
        end if;
        if not public.seating_chart_check_pin(target_slug, 'edit', candidate_edit_pin, client_ip) then
            raise exception 'Incorrect PIN.';
        end if;
    end if;

    update public.seating_chart_venues
    set venue_data = new_venue_data
    where slug = target_slug
    returning updated_at into updated;

    if updated is null then
        raise exception 'Chart not found.';
    end if;

    return jsonb_build_object('success', true, 'updatedAt', updated);
end;
$$;

drop function if exists public.seating_chart_set_pin(text, text, text);
create or replace function public.seating_chart_set_edit_pin(
    session_token text,
    target_slug text,
    new_pin text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    resolved_pin text;
    updated timestamptz;
begin
    perform public.require_session(session_token, 'admin');

    resolved_pin := nullif(trim(coalesce(new_pin, '')), '');
    if resolved_pin is null then
        resolved_pin := lpad(floor(random() * 10000)::int::text, 4, '0');
    elsif resolved_pin !~ '^\d{4}$' then
        raise exception 'PIN must be a 4-digit number.';
    end if;

    update public.seating_chart_venues
    set hashed_edit_pin = crypt(resolved_pin, gen_salt('bf'))
    where slug = target_slug
    returning updated_at into updated;

    if updated is null then
        raise exception 'Chart not found.';
    end if;

    return jsonb_build_object('success', true, 'pin', resolved_pin);
end;
$$;

-- Admin-only: toggle whether viewing this venue requires a PIN. Turning
-- it on (re)generates or accepts a custom view PIN; turning it off
-- clears the stored view PIN entirely, so re-enabling later always
-- starts from a fresh one.
create or replace function public.seating_chart_set_view_pin(
    session_token text,
    target_slug text,
    enabled boolean,
    new_pin text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    resolved_pin text;
    updated timestamptz;
begin
    perform public.require_session(session_token, 'admin');

    if not enabled then
        update public.seating_chart_venues
        set view_pin_required = false,
            hashed_view_pin = null
        where slug = target_slug
        returning updated_at into updated;

        if updated is null then
            raise exception 'Chart not found.';
        end if;

        return jsonb_build_object('success', true, 'enabled', false, 'pin', null);
    end if;

    resolved_pin := nullif(trim(coalesce(new_pin, '')), '');
    if resolved_pin is null then
        resolved_pin := lpad(floor(random() * 10000)::int::text, 4, '0');
    elsif resolved_pin !~ '^\d{4}$' then
        raise exception 'PIN must be a 4-digit number.';
    end if;

    update public.seating_chart_venues
    set view_pin_required = true,
        hashed_view_pin = crypt(resolved_pin, gen_salt('bf'))
    where slug = target_slug
    returning updated_at into updated;

    if updated is null then
        raise exception 'Chart not found.';
    end if;

    return jsonb_build_object('success', true, 'enabled', true, 'pin', resolved_pin);
end;
$$;

drop function if exists public.seating_chart_validate_pin(text, text, text);
create or replace function public.seating_chart_validate_pin(
    target_slug text,
    pin_kind text,
    candidate_pin text,
    client_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    return jsonb_build_object(
        'success',
        public.seating_chart_check_pin(target_slug, pin_kind, candidate_pin, client_ip)
    );
end;
$$;
