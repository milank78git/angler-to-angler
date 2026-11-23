\set ON_ERROR_STOP on
begin;
create schema auth;
create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
create role anon; create role authenticated;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
\ir ../supabase/migrations/20261123070056_profiles.sql
insert into auth.users values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
do $$begin
 if has_function_privilege('anon','public.angler_profile()','execute') or has_table_privilege('authenticated','angler_private.profiles','select') then raise exception 'excess privilege';end if;
end$$;
set local role authenticated;
set local "request.jwt.claim.sub"='11111111-1111-4111-8111-111111111111';
do $$begin
 begin perform public.angler_accept('River','old','2026-11-23');raise exception 'accepted old terms';exception when invalid_parameter_value then null;end;
 if public.angler_profile() is not null then raise exception 'unexpected profile';end if;
 perform public.angler_accept('River','2026-11-23','2026-11-23');
 perform public.angler_accept('Other','2026-11-23','2026-11-23');
 if public.angler_profile()->>'name' <> 'River' or public.angler_profile()->>'current' <> 'true' then raise exception 'profile mismatch';end if;
end$$;
set local "request.jwt.claim.sub"='22222222-2222-4222-8222-222222222222';
do $$begin if public.angler_profile() is not null then raise exception 'cross-account read';end if;end$$;
set local "request.jwt.claims"='{"is_anonymous":true}';
do $$begin begin perform public.angler_accept('Guest','2026-11-23','2026-11-23');raise exception 'anonymous accepted';exception when insufficient_privilege then null;end;end$$;
reset role;
do $$begin if (select count(*) from angler_private.acceptances)<>1 then raise exception 'duplicate acceptance';end if;end$$;
delete from auth.users;
do $$begin if exists(select from angler_private.acceptances) or exists(select from angler_private.profiles) then raise exception 'deletion incomplete';end if;end$$;
\ir groups-db.sql
\ir profile-card-db.sql
\ir group-tips-db.sql
\ir discussions-db.sql
rollback;
