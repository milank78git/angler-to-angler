\ir ../supabase/migrations/20261123232227_test_tip_market.sql
insert into auth.users select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()
 from generate_series(71,74)n;
select pg_temp.check_that(not has_function_privilege('anon','public.angler_market_detail(uuid)','execute')
 and not has_table_privilege('authenticated','angler_market.versions','select')
 and not has_table_privilege('authenticated','angler_market.wallets','update'),'Unexpected market grants');
set local role authenticated;
set local "request.jwt.claims"='{}';
do $$
declare offer uuid:=gen_random_uuid(); other_offer uuid:=gen_random_uuid(); page jsonb; unlocked jsonb;
 draft jsonb:=jsonb_build_object('title','Morning on the river','species','Carp','access','shore','day','2026-01-01',
 'water','CZ:401001','technique','Private groundbait instructions','price',60,'limit',1);
begin
 for n in 71..74 loop
   perform pg_temp.as_user(n); perform public.angler_accept('Angler '||n,'2026-11-23','2026-11-23');
 end loop;
 perform pg_temp.as_user(71);
 perform public.angler_market_publish(offer,0,draft); perform public.angler_market_publish(offer,0,draft);
 begin perform public.angler_market_buy(offer,1,60); raise exception 'Self-purchase'; exception when insufficient_privilege then null; end;
 perform pg_temp.as_user(72);
 page:=public.angler_market_list('browse');
 perform pg_temp.check_that(page->>'balance' is null and position('groundbait' in page::text)=0
   and not (public.angler_market_detail(offer) ? 'technique'),'Private content exposed');
 begin perform public.angler_market_publish(offer,1,draft); raise exception 'Foreign edit'; exception when sqlstate 'PT404' then null; end;
 begin perform public.angler_market_buy(offer,1,60); raise exception 'Bought without credits'; exception when sqlstate 'PT402' then null; end;
 perform pg_temp.check_that(public.angler_market_activate()->>'balance'='100','Starting grant');
 begin perform public.angler_market_buy(offer,1,1); raise exception 'Wrong price'; exception when sqlstate 'PT409' then null; end;
 perform public.angler_market_buy(offer,1,60); perform public.angler_market_buy(offer,1,60);
 perform pg_temp.check_that(public.angler_market_activate()->>'balance'='40','Duplicate debit or grant');
 perform pg_temp.as_user(73); perform public.angler_market_activate();
 begin perform public.angler_market_buy(offer,1,60); raise exception 'Oversold'; exception when sqlstate 'PT409' then null; end;
 perform pg_temp.as_user(71);
 draft:=draft||'{"price":70,"limit":2,"technique":"Updated presentation instructions"}';
 perform public.angler_market_publish(offer,1,draft); perform public.angler_market_publish(offer,1,draft);
 perform public.angler_market_publish(other_offer,0,draft);
 perform pg_temp.as_user(72);
 begin perform public.angler_market_buy(other_offer,1,70); raise exception 'Negative balance'; exception when sqlstate 'PT402' then null; end;
 perform pg_temp.as_user(73);
 begin perform public.angler_market_buy(offer,1,60); raise exception 'Stale revision'; exception when sqlstate 'PT409' then null; end;
 perform public.angler_market_buy(offer,2,70);
 perform pg_temp.as_user(71); perform public.angler_market_withdraw(offer);
 perform pg_temp.as_user(72);
 perform pg_temp.check_that(public.angler_market_buy(offer,1,60)->>'revision'='1','Retry after withdrawal');
 unlocked:=public.angler_market_detail(offer);
 perform pg_temp.check_that(unlocked->>'technique'='Private groundbait instructions' and unlocked->>'price'='60'
   and unlocked->>'balance'='40' and unlocked->>'sold'='2','Lost original purchase');
 perform pg_temp.check_that(public.angler_market_list('purchased')->'items'->0->>'revision'='1','Wrong shelf version');
 perform pg_temp.as_user(74);
 begin perform public.angler_market_detail(offer); raise exception 'Read withdrawn offer'; exception when sqlstate 'PT404' then null; end;
end$$;
reset role;
