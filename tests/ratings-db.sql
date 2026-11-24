\ir ../supabase/migrations/20261124000054_purchased_tip_ratings.sql
-- Exercise purchases created before this migration, including two different versions of a withdrawn offer.
savepoint rating_fixture;
select pg_temp.check_that(not has_function_privilege('anon','public.angler_market_rate(uuid,integer,integer,integer)','execute')
  and not has_function_privilege('authenticated','angler_market.author_rating(uuid)','execute')
  and not has_table_privilege('authenticated','angler_market.orders','select'),'Unexpected rating privileges');
set local role authenticated;
select pg_temp.as_user(72);
select (public.angler_market_list('purchased')->'items'->0->>'id')::uuid as rated_offer \gset
select set_config('test.rating_offer', :'rated_offer', true);
do $$
declare item uuid:=current_setting('test.rating_offer')::uuid; seller uuid:='00000000-0000-4000-8000-000000000071';
  active_offer uuid; first_rating jsonb; summary jsonb;
begin
  perform pg_temp.check_that(public.angler_market_detail(item)->'myRating'='null'::jsonb,'Legacy order cannot be rated');
  begin perform public.angler_market_rate(item,null,4,3); raise exception 'Incomplete rating'; exception when sqlstate 'PT422' then null; end;
  begin perform public.angler_market_rate(item,6,4,3); raise exception 'High score'; exception when sqlstate 'PT422' then null; end;
  begin perform public.angler_market_rate(item,5,0,3); raise exception 'Low score'; exception when sqlstate 'PT422' then null; end;
  first_rating:=public.angler_market_rate(item,5,4,3);
  perform pg_temp.check_that(public.angler_market_rate(item,5,4,3)=first_rating and
    public.angler_market_detail(item)->'myRating'=first_rating,'Lost rating receipt');
  begin perform public.angler_market_rate(item,1,4,3); raise exception 'Replaced a rating'; exception when sqlstate 'PT409' then null; end;
  perform pg_temp.as_user(71);
  begin perform public.angler_market_rate(item,5,5,5); raise exception 'Self rating'; exception when sqlstate 'PT404' then null; end;
  perform pg_temp.check_that(not (public.angler_market_detail(item) ? 'myRating'),'Author saw another buyer scores');
  perform pg_temp.as_user(73);
  perform pg_temp.check_that(public.angler_market_detail(item)->'myRating'='null'::jsonb,'Second buyer saw first scores');
  perform public.angler_market_rate(item,1,2,4);
  perform pg_temp.as_user(74);
  begin perform public.angler_market_rate(item,5,5,5); raise exception 'Non-buyer rated'; exception when sqlstate 'PT404' then null; end;
  begin perform public.angler_card(seller); raise exception 'Private profile exposed'; exception when sqlstate 'PT404' then null; end;
  active_offer:=(public.angler_market_list('browse')->'items'->0->>'id')::uuid;
  summary:=public.angler_market_detail(active_offer)->'authorRating';
  perform pg_temp.check_that(summary='{"count":2,"average":3.2,"accuracy":3,"technique":3,"match":3.5}'::jsonb
    and public.angler_market_list('browse')->'items'->0->'authorRating'=summary,'Public preview totals');
  perform pg_temp.as_user(71);
  perform pg_temp.check_that(public.angler_card()->'authorRating'=summary,'Seller profile totals');
  perform public.angler_save_card(0,'','','',1,null,true);
  perform pg_temp.as_user(74);
  perform pg_temp.check_that(public.angler_card(seller)->'authorRating'=summary,'Shared profile totals');
end$$;
reset role;
delete from auth.users where id in ('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000073');
set local role authenticated;
select pg_temp.as_user(71);
select pg_temp.check_that(public.angler_card()->'authorRating'->>'count'='0' and
  public.angler_card()->'authorRating'->'average'='null'::jsonb and
  public.angler_market_detail(:'rated_offer')->>'sold'='2','Erasure left scores or changed lifetime stock');
reset role;
rollback to savepoint rating_fixture;
