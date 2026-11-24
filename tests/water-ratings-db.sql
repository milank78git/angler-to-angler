\ir ../supabase/migrations/20261124115256_water_reviews_and_visit_statistics.sql
set local role authenticated;
select pg_temp.as_user(71);
do $$
declare r jsonb;
begin
  r := public.angler_water_rate('CZ:401009',4);
  if r->>'mine' is distinct from '4' then raise exception 'Rating missing'; end if;
  perform public.angler_water_rate('CZ:401009',4);
  perform pg_temp.as_user(72);
  r := public.angler_water_rate('CZ:401009',2);
  if r->>'count' is distinct from '2' or (r->>'average')::numeric<>3 then raise exception 'Aggregate mismatch'; end if;
  perform public.angler_water_rate('CZ:401009',5);
  perform pg_temp.as_user(71);
  r := public.angler_water_rate('CZ:401009',null);
  if r->>'count' is distinct from '1' or (r->>'average')::numeric<>5 or r->>'mine' is not null then raise exception 'Withdrawal mismatch'; end if;
  begin perform public.angler_water_rate('CZ:401009',6); raise exception 'Invalid rating accepted';
  exception when sqlstate 'PT422' then null; end;
  if has_function_privilege('anon','public.angler_water_rate(text,integer)','execute') then raise exception 'Anonymous rating'; end if;
  perform public.angler_top_waters();
end $$;
reset role;

insert into auth.users select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()
  from generate_series(151,155) n;
-- A blank trip is still a visit; a withdrawal must immediately hide a sub-threshold venue.
set local role authenticated;
do $$
declare period date := (date_trunc('month',(timezone('Europe/Prague',now())::date-7)::timestamp)-interval '1 month')::date;
  last_trip uuid; last_revision integer; result jsonb; venue text := 'CZ:401001';
begin
  for i in 1..10 loop
    perform pg_temp.as_user(151+i%5);
    perform public.angler_accept('Visitor '||i,'2026-11-23','2026-11-23');
    last_trip := gen_random_uuid();
    last_revision := (public.angler_activity_change(last_trip,0,venue,period,'unspecified','other',0)->>'revision')::integer;
  end loop;
  result := public.angler_top_waters();
  if not (result->'waters' @> jsonb_build_array(jsonb_build_object('water',venue,'visits',10))) then
    raise exception 'Eligible shared visits missing'; end if;
  perform public.angler_activity_change(last_trip,last_revision);
  if public.angler_top_waters()->'waters' @> jsonb_build_array(jsonb_build_object('water',venue)) then
    raise exception 'Unsafe sample after withdrawal'; end if;
end $$;
reset role;
