-- Keep special_message independent from song_request.
-- The prior submit_rsvp definition copied song_request into special_message
-- when specialMessage was omitted.
create or replace function public.submit_rsvp(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    submitter_name text := trim(coalesce(payload->>'name', payload->>'rsvpName', ''));
    submitter_email text := trim(coalesce(payload->>'email', payload->>'rsvpEmail', ''));
    guest_group_id text := nullif(trim(coalesce(payload->>'guestGroupId', '')), '');
    normalized_dietary text := nullif(trim(coalesce(payload->>'dietaryRestrictions', '')), '');
    normalized_message text := nullif(trim(coalesce(payload->>'specialMessage', '')), '');
    normalized_song_request text := nullif(trim(coalesce(payload->>'songRequest', '')), '');
    normalized_meal_choice text := nullif(trim(coalesce(payload->>'mealChoice', '')), '');
    guest_responses jsonb := coalesce(payload->'guestResponses', '[]'::jsonb);
    child_meal_name text := coalesce((
        select mi.name
        from public.menu_items mi
        where mi.is_active = true
          and mi.is_child_meal = true
        order by mi.sort_order asc, mi.id asc
        limit 1
    ), 'Child''s Meal');
    accepted_count integer := 0;
    attending_flag boolean := false;
begin
    if submitter_name = '' then
        raise exception 'RSVP name is required.';
    end if;

    if submitter_email = '' then
        raise exception 'RSVP email is required.';
    end if;

    if guest_group_id is null and jsonb_array_length(guest_responses) > 0 then
        raise exception 'guestGroupId is required when submitting per-guest responses.';
    end if;

    select count(*) filter (where lower(coalesce(entry.value->>'status', '')) = 'accepted')
    into accepted_count
    from jsonb_array_elements(guest_responses) as entry(value);

    attending_flag := accepted_count > 0 or lower(coalesce(payload->>'attending', '')) in ('yes', 'true');

    insert into public.rsvp_submissions (
        group_id,
        submitter_name,
        submitter_email,
        attending,
        guest_count,
        meal_choice,
        dietary_notes,
        special_message,
        song_request
    ) values (
        guest_group_id,
        submitter_name,
        submitter_email,
        attending_flag,
        greatest(coalesce(nullif(payload->>'guestCount', '')::integer, accepted_count, 1), 1),
        normalized_meal_choice,
        normalized_dietary,
        normalized_message,
        normalized_song_request
    );

    if jsonb_array_length(guest_responses) > 0 then
        update public.guests guest
        set rsvp_status = case lower(coalesce(entry.value->>'status', ''))
                when 'accepted' then 'accepted'
                when 'declined' then 'declined'
                else guest.rsvp_status
            end,
            meal_choice = case
                when lower(coalesce(entry.value->>'status', '')) = 'accepted' and guest.is_child then child_meal_name
                when lower(coalesce(entry.value->>'status', '')) = 'accepted' then coalesce(nullif(trim(coalesce(entry.value->>'mealChoice', '')), ''), guest.meal_choice)
                else guest.meal_choice
            end,
            full_name = coalesce(nullif(trim(coalesce(entry.value->>'name', '')), ''), guest.full_name),
            last_rsvp_at = timezone('utc', now()),
            updated_at = timezone('utc', now())
        from jsonb_array_elements(guest_responses) as entry(value)
        where guest.id = nullif(entry.value->>'guestId', '')::bigint
          and guest.group_id = guest_group_id;
    elsif guest_group_id is not null then
        update public.guests
        set rsvp_status = case when attending_flag then 'accepted' else 'declined' end,
            meal_choice = case
                when attending_flag and is_child then child_meal_name
                else coalesce(normalized_meal_choice, meal_choice)
            end,
            last_rsvp_at = timezone('utc', now()),
            updated_at = timezone('utc', now())
        where group_id = guest_group_id;
    end if;

    if guest_group_id is not null and normalized_dietary is not null then
        update public.guests
        set dietary_notes = normalized_dietary,
            updated_at = timezone('utc', now())
        where group_id = guest_group_id;
    end if;

    return jsonb_build_object(
        'success', true,
        'status', case when attending_flag then 'accepted' else 'declined' end,
        'message', case when attending_flag
            then 'Thank you for your RSVP! We cannot wait to celebrate with you.'
            else 'We appreciate the update and will miss you at the celebration.'
        end
    );
end;
$$;
