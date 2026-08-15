-- Fix seating_chart_create_venue: the prior migration
-- (20260816090000_seating_chart_view_edit_pins.sql) renamed
-- seating_chart_venues.hashed_pin to hashed_edit_pin and redefined every
-- other seating-chart function to match, but missed this one — its body
-- still inserted into the now-nonexistent hashed_pin column, breaking
-- venue creation ("column \"hashed_pin\" of relation
-- \"seating_chart_venues\" does not exist"). Re-creating it here with the
-- correct column name; this is otherwise byte-for-byte the same function
-- already shipped in schema.sql.

create or replace function public.seating_chart_create_venue(
    session_token text,
    slug text,
    event_title text default 'New Event'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    generated_pin text;
begin
    perform public.require_session(session_token, 'admin');

    if trim(coalesce(slug, '')) = '' then
        raise exception 'slug is required.';
    end if;

    generated_pin := lpad(floor(random() * 10000)::int::text, 4, '0');

    insert into public.seating_chart_venues (slug, venue_data, hashed_edit_pin)
    values (
        slug,
        jsonb_build_object(
            'shapes', '[]'::jsonb,
            'guests', '[]'::jsonb,
            'eventTitle', coalesce(nullif(trim(event_title), ''), 'New Event'),
            'tableCounter', 1
        ),
        crypt(generated_pin, gen_salt('bf'))
    );

    return jsonb_build_object('success', true, 'slug', slug, 'pin', generated_pin);
end;
$$;
