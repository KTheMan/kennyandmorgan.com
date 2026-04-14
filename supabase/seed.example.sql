insert into public.access_passwords (level, password_hash)
values
    ('family', crypt('family-password-here', gen_salt('bf'))),
    ('party', crypt('party-password-here', gen_salt('bf'))),
    ('admin', crypt('admin-password-here', gen_salt('bf')))
on conflict (level) do update set password_hash = excluded.password_hash;

insert into public.registry_items (store, name, url, image, price, wanted_quantity, purchased_quantity, sort_order)
values
    ('zola', 'Example Registry Item', 'https://www.zola.com/', null, 49.99, 1, 0, 10)
on conflict do nothing;
