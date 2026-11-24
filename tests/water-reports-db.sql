\ir ../supabase/migrations/20261124030000_water_reports.sql
set local role authenticated;
do $$
declare result jsonb;
begin
 for n in 71..73 loop
   perform pg_temp.as_user(n);
   perform public.angler_water_report('US-MT:39754243','low_water',false);
   perform public.angler_water_report('US-MT:39754243','low_water',false);
 end loop;
 result:=public.angler_water_alerts('US-MT:39754243');
 perform pg_temp.check_that(result->'low_water'='{"count":3,"mine":true}'::jsonb,'Repeated account counted twice');
 perform public.angler_water_report('US-MT:39754243','low_water',true);
 perform pg_temp.check_that(public.angler_water_alerts('US-MT:39754243')->'low_water'='{"count":2,"mine":false}'::jsonb,'Unexpected withdrawal count');
end $$;
reset role;
