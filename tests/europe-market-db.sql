\ir ../supabase/migrations/20261124004714_european_market_directory.sql
-- Keep pre-catalogue purchases readable, while new public posts use a controlled species and water key.
savepoint directory_fixture;
select pg_temp.check_that(not has_function_privilege('authenticated','angler_market.publish_validated_draft(uuid,integer,jsonb)','execute')
 and not has_function_privilege('anon','public.angler_market_discover(text,bigint)','execute'),'Unexpected market grants');
set local role authenticated;
select pg_temp.as_user(71);
do $$
declare item uuid:=gen_random_uuid(); draft jsonb:='{"title":"Evening float","species":"Pike","access":"shore","day":"2026-01-01","water":"CZ:401001","technique":"Use a small float","price":5,"limit":null}';
 before_count integer; result jsonb; saved jsonb;
begin
 before_count:=(public.angler_market_discover('CZ:401001')->'stats'->>'offers')::int;
 begin perform public.angler_market_publish(item,0,draft||'{"species":"invented fish"}');
   raise exception 'Accepted unknown species'; exception when sqlstate 'PT422' then null; end;
 saved:=public.angler_market_publish(item,0,draft);
 perform pg_temp.check_that(saved=public.angler_market_publish(item,0,draft||'{"species":"Esox lucius"}'),'Duplicate alias submission');
 result:=public.angler_market_discover('CZ:401001');
 perform pg_temp.check_that((result->'stats'->>'offers')::int=before_count+1 and result->'items'->0->>'species'='Esox lucius'
   and not (result->'items'->0 ? 'technique') and (public.angler_market_discover('missing')->'stats'->>'offers')::int=0,'Incorrect water filter');
 perform pg_temp.as_user(74); perform public.angler_market_activate(); perform public.angler_market_buy(item,1,5);
 perform public.angler_market_rate(item,3,4,5);
 result:=public.angler_market_detail(item);
 perform pg_temp.check_that(result->'offerRating'='{"count":1,"average":4}'::jsonb and result->>'sold'='1','Incorrect tip statistics');
 perform pg_temp.check_that(public.angler_market_discover('CZ:401001',0)->'stats'=public.angler_market_discover('CZ:401001')->'stats',
  'Counts must be independent of pagination');
 perform pg_temp.as_user(71); perform public.angler_market_withdraw(item);
 perform pg_temp.check_that((public.angler_market_discover('CZ:401001')->'stats'->>'offers')::int=before_count,'Withdrawn tip still counted');
end$$;
reset role;
rollback to savepoint directory_fixture;
