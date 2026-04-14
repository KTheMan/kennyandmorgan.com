set search_path = public, extensions;

insert into public.access_passwords (level, password_hash)
values
    ('family', crypt('family-password-here', gen_salt('bf'))),
    ('party', crypt('party-password-here', gen_salt('bf'))),
    ('admin', crypt('admin-password-here', gen_salt('bf')))
on conflict (level) do update set password_hash = excluded.password_hash;
