-- These profiles were distinct under the previous unique index.
insert into auth.users select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, now()
  from generate_series(960,970) n;
insert into angler_private.profiles(user_id,display_name,created_at,original_display_name) values
 ('00000000-0000-4000-8000-000000000960','River Carp','2026-01-01',null),
 ('00000000-0000-4000-8000-000000000961',U&'Ri\200Bver Carp','2026-02-01',null),
 ('00000000-0000-4000-8000-000000000962',U&'River C\0430rp','2026-03-01','Prior nickname'),
 ('00000000-0000-4000-8000-000000000963','River Carp #00000000','2026-04-01',null),
 ('00000000-0000-4000-8000-000000000964',U&'\200B\2060','2026-05-01',null);
\ir ../supabase/migrations/20261126045000_nickname_identity.sql
select pg_temp.check_that((select display_name='River Carp' and original_display_name is null
 from angler_private.profiles where user_id='00000000-0000-4000-8000-000000000960'), 'Oldest nickname changed');
select pg_temp.check_that((select display_name like '%#00000000-1' and original_display_name=U&'Ri\200Bver Carp'
 from angler_private.profiles where user_id='00000000-0000-4000-8000-000000000961'), 'Occupied suffix or original spelling lost');
select pg_temp.check_that((select display_name like '%#00000000-2' and original_display_name='Prior nickname'
 from angler_private.profiles where user_id='00000000-0000-4000-8000-000000000962'), 'Earlier audit history lost');
select pg_temp.check_that((select display_name='Angler #00000000' and original_display_name=U&'\200B\2060'
 from angler_private.profiles where user_id='00000000-0000-4000-8000-000000000964'), 'Invisible old name not repaired');
select pg_temp.check_that(angler_private.nickname_key(U&'r\030Ceka') = angler_private.nickname_key(U&'\0159eka')
  and angler_private.nickname_key(U&'\0159eka') <> angler_private.nickname_key('reka')
  and angler_private.nickname_key('Gill') <> angler_private.nickname_key('Giii'), 'Distinct Latin names or accent normalization changed');

set local role authenticated;
select pg_temp.as_user(965);
do $$
declare candidate text;
begin
  foreach candidate in array array[U&'Ri\200Bver Carp', U&'River Car\2060p', U&'Riv\0435r Carp',
        U&'RI\200BVER  C\0410RP', U&'Riv\+0E0100er Carp'] loop
    begin
      perform public.angler_accept(candidate,'2026-11-23','2026-11-23');
      raise exception 'Confusable registration accepted: %', candidate;
    exception when sqlstate 'PT409' then null;
    end;
  end loop;
  foreach candidate in array array[U&'\2060\200B', U&'Q\200B'] loop
    begin
      perform public.angler_accept(candidate,'2026-11-23','2026-11-23');
      raise exception 'Invisible name or padding accepted';
    exception when check_violation then null;
    end;
  end loop;
  perform pg_temp.check_that(public.angler_accept('Щука','2026-11-23','2026-11-23')->>'name'='Щука',
    'A distinct Cyrillic name must retain its spelling');
end $$;
select pg_temp.as_user(966);
select public.angler_accept('Coca','2026-11-23','2026-11-23');
select pg_temp.as_user(967);
do $$begin
 begin perform public.angler_accept('Соса','2026-11-23','2026-11-23');
   raise exception 'Whole-script lookalike accepted'; exception when sqlstate 'PT409' then null; end;
 perform pg_temp.check_that(public.angler_accept('Окунь','2026-11-23','2026-11-23')->>'name'='Окунь','Second distinct Cyrillic name rejected');
end$$;
reset role;
