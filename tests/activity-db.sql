\ir ../supabase/migrations/20261123171108_water_activity.sql
insert into auth.users select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()
  from generate_series(40,44) n;
select pg_temp.check_that(not has_table_privilege('authenticated','angler_activity.trips','select')
  and not has_function_privilege('anon','public.angler_activity_summary(text,date,text,text)','execute'),'Activity grants');
set local role authenticated;
do $$
declare m date:=date '2025-06-01'; w text:='CZ:401009'; id uuid:=gen_random_uuid();
  another uuid:=gen_random_uuid(); receipt jsonb; data jsonb; latest date;
begin
  for n in 40..44 loop
    perform pg_temp.as_user(n); perform public.angler_accept('Pilot '||n,'2026-11-23','2026-11-23');
  end loop;
  select (public.angler_activity_summary(w)->>'latest')::date into latest;
  perform pg_temp.check_that(latest=(date_trunc('month',((now() at time zone 'Europe/Prague')::date-7)::timestamp)
    - interval '1 month')::date,'Latest eligible period');
  begin perform public.angler_activity_summary(w,(latest+interval '1 month')::date);
    raise exception 'Too recent'; exception when sqlstate 'PT422' then null; end;
  begin perform public.angler_activity_change(id,0,w,m+1,'pike','fly',1);
    raise exception 'Exact date accepted'; exception when sqlstate 'PT422' then null; end;
  begin perform public.angler_activity_change(id,0,'unlisted',m,'pike','fly',1);
    raise exception 'Custom location accepted'; exception when sqlstate 'PT422' then null; end;
  begin perform public.angler_activity_change(id,0,w,m,'pike','fly',-1);
    raise exception 'Negative count accepted'; exception when sqlstate 'PT422' then null; end;
  perform pg_temp.as_user(40);
  receipt:=public.angler_activity_change(id,0,w,m,'pike','fly',0);
  perform pg_temp.check_that(receipt=public.angler_activity_change(id,0,w,m,'pike','fly',0),'Duplicate delivery');
  perform pg_temp.as_user(41);
  perform pg_temp.check_that(public.angler_activity_state(id)->>'revision'='0','Other account read receipt');
  begin perform public.angler_activity_change(id,1);raise exception 'Foreign withdrawal';exception when sqlstate 'PT404' then null;end;
  for n in 1..8 loop
    perform pg_temp.as_user(40+n%4);
    perform public.angler_activity_change(gen_random_uuid(),0,w,m,'pike','fly',1);
  end loop;
  perform pg_temp.as_user(40); perform public.angler_activity_change(another,0,w,m,'pike','fly',2);
  perform pg_temp.check_that(public.angler_activity_summary(w,m)->'sample'='null'::jsonb,'Ten trips by four anglers exposed');
  perform pg_temp.as_user(44); perform public.angler_activity_change(gen_random_uuid(),0,w,m,'pike','fly',3);
  data:=public.angler_activity_summary(w,m,'pike','fly')->'sample';
  perform pg_temp.check_that(data='{"trips":11,"anglers":5,"fish":13,"successfulTrips":10}'::jsonb,'Eligible counts or blank trips');
  perform public.angler_activity_change(gen_random_uuid(),0,w,m,'roach','bottom',4);
  perform pg_temp.check_that(public.angler_activity_summary(w,m)->'sample'->>'trips'='12'
    and public.angler_activity_summary(w,m,'pike')->'sample'='null'::jsonb
    and public.angler_activity_summary(w,m,null,'fly')->'sample'='null'::jsonb,'Small complement exposed');
  for n in 1..9 loop
    perform pg_temp.as_user(40+n%5);perform public.angler_activity_change(gen_random_uuid(),0,w,m,'roach','bottom',1);
  end loop;
  perform pg_temp.check_that(public.angler_activity_summary(w,m,'roach','bottom')->'sample'->'successfulTrips'='null'::jsonb
    and public.angler_activity_summary(w,m,null,'bottom')->'sample'->>'trips'='10','Safe method filter or false success rate');
  perform public.angler_activity_change(gen_random_uuid(),0,w,m,'pike','bottom',1);
  perform pg_temp.check_that(public.angler_activity_summary(w,m,'pike')->'sample'->>'trips'='12'
    and public.angler_activity_summary(w,m,null,'bottom')->'sample'='null'::jsonb
    and public.angler_activity_summary(w,m,'pike','fly')->'sample'='null'::jsonb,'Overlapping margins exposed');
  perform pg_temp.check_that(public.angler_activity_summary('CZ:401001',m)->'sample'='null'::jsonb,'Water isolation');
  perform pg_temp.as_user(40);
  receipt:=public.angler_activity_change(id,1);
  perform pg_temp.check_that(receipt=public.angler_activity_change(id,1) and receipt->'entry'='null'::jsonb,'Withdrawal retry');
  begin perform public.angler_activity_change(id,0,w,m,'pike','fly',0);raise exception 'Old request restored';exception when sqlstate 'PT409' then null;end;
  receipt:=public.angler_activity_change(id,2,w,m,'pike','fly',1);
  perform pg_temp.check_that(receipt->>'revision'='3','New explicit contribution');
  for n in 1..23 loop
    perform public.angler_activity_change(gen_random_uuid(),0,w,m,'roach','fly',0);
  end loop;
  data:=public.angler_activity_mine();
  perform pg_temp.check_that(jsonb_array_length(data->'items')=20 and data->>'next' is not null,'First personal page');
  receipt:=public.angler_activity_mine((data->>'next')::bigint);
  perform pg_temp.check_that(jsonb_array_length(receipt->'items')>0 and not exists(
    select 1 from jsonb_array_elements(data->'items') a join jsonb_array_elements(receipt->'items') b
      on a->'entry'->>'trip'=b->'entry'->>'trip'),'Personal pagination overlap');
  -- Five distinct anglers are still insufficient at nine trips. With one small species
  -- and a single safe method, only the method and whole-water totals may be retrieved.
  for n in 1..9 loop
    perform pg_temp.as_user(40+n%5);perform public.angler_activity_change(gen_random_uuid(),0,'CZ:401001',m,'pike','fly',1);
  end loop;
  perform pg_temp.check_that(public.angler_activity_summary('CZ:401001',m)->'sample'='null'::jsonb,'Nine trips exposed');
  perform public.angler_activity_change(gen_random_uuid(),0,'CZ:401001',m,'roach','fly',0);
  perform pg_temp.check_that(public.angler_activity_summary('CZ:401001',m,null,'fly')->'sample'->>'trips'='10'
    and public.angler_activity_summary('CZ:401001',m,'pike')->'sample'='null'::jsonb,'Method-only fallback');
  perform pg_temp.as_user(99);
  begin perform public.angler_activity_state(gen_random_uuid());raise exception 'Unverified read';exception when insufficient_privilege then null;end;
end $$;
reset role;
delete from auth.users where id='00000000-0000-4000-8000-000000000040';
select pg_temp.check_that(not exists(select from angler_activity.trips where author='00000000-0000-4000-8000-000000000040'),
  'Account deletion left activity data');
