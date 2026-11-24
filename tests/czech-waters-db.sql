\ir ../supabase/migrations/20261124050000_czech_waters.sql
-- Real source keys exercise both public write paths and report isolation across publishers.
set local role authenticated;
select pg_temp.as_user(71);
select public.angler_water_report('CZ:MRS:1','closure',false);
select pg_temp.check_that(public.angler_water_alerts('CZ:MRS:1')->'closure'='{"mine":true,"count":1}'::jsonb,
  'Imported MRS water did not accept the observation');
select pg_temp.check_that(public.angler_water_alerts('CZ:CRS:4615402')='{}'::jsonb,
  'Report leaked to an unrelated imported water');
select pg_temp.check_that(public.angler_market_discover('CZ:MRS:1',null)->'stats'->>'offers'='0',
  'New water has unexpected market offers');
reset role;
