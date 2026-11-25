\ir ../supabase/migrations/20261125092414_private_angler_details.sql
set local role authenticated;
select pg_temp.as_user(71);
do $$declare data jsonb := '{"age":48,"expiry":"2028-03-31","reminder":"month","revision":0}'; begin
 perform pg_temp.check_that(public.angler_my_details()->>'revision'='0','Existing account default');
 perform pg_temp.check_that(public.angler_my_details(data)->>'revision'='1','First save');
 perform pg_temp.check_that(public.angler_my_details(data)->>'revision'='1','Idempotent retry');
 begin perform public.angler_my_details(data || '{"age":49}'); raise exception 'Stale edit accepted';
 exception when sqlstate 'PT409' then null; end;
 perform pg_temp.as_user(72);
 perform pg_temp.check_that(public.angler_my_details() = '{"age":null,"expiry":null,"reminder":"off","revision":0}','Another account visible');
 begin perform public.angler_my_details(data || '{"expiry":"2027-02-29"}'); raise exception 'Invalid date';
 exception when sqlstate 'PT422' then null; end;
 begin perform public.angler_my_details(data || '{"age":126}'); raise exception 'Invalid age';
 exception when sqlstate 'PT422' then null; end;
 begin perform public.angler_my_details(data || '{"expiry":null}'); raise exception 'Missing expiry';
 exception when sqlstate 'PT422' then null; end;
 perform pg_temp.as_user(71);
 perform pg_temp.check_that(public.angler_my_details('{"age":null,"expiry":null,"reminder":"off","revision":1}')->>'revision'='2','Clear values');
end $$;
reset role;
select pg_temp.check_that(not has_table_privilege('authenticated','angler_private.angler_details','select')
   and not has_function_privilege('anon','public.angler_my_details(jsonb)','execute'),'Private privileges');
