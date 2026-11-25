create role service_role;
\ir ../supabase/migrations/20261125075304_play_market_settlement.sql
update angler_commerce.settings set mode='test';
set local role authenticated;
select pg_temp.as_user(71);
do $$declare w jsonb; begin
 w:=public.angler_commerce('status');
 perform pg_temp.check_that(w->>'balance'='10' and w->>'earned'='0','Pilot money converted');
 perform pg_temp.check_that(not has_function_privilege('authenticated','public.angler_play_receipt(text,jsonb)','execute')
   and not has_function_privilege('anon','public.angler_commerce(text,jsonb)','execute'),'Unexpected ledger privilege');
 begin perform public.angler_commerce('payout');raise exception 'Payout below minimum';exception when sqlstate 'PT422' then null;end;
end $$;
reset role;
-- Create three enrolled offers and sell two, including a mixed bonus / paid purchase.
do $$declare id uuid; draft jsonb:='{"title":"River technique","species":"Pike","access":"shore","day":"2026-01-01","water":null,"technique":"Use a slow retrieve","price":100,"limit":null}';
 h text:=repeat('f',64); h2 text:=repeat('a',64); args jsonb; buyer uuid; wallet jsonb; begin
 for i in 1..3 loop
   id:=md5('commercial tip '||i)::uuid;
   perform public.angler_market_publish(id,0,draft);
   perform public.angler_commerce('enroll',jsonb_build_object('offer',id,'revision',1));
 end loop;
 for i in 1..2 loop
   perform pg_temp.as_user(71+i);buyer:=auth.uid();
   args:=jsonb_build_object('holder',buyer,'sku','credits_100_czk','mode','test','order','fixture-order-'||i,'hash',case i when 1 then h else h2 end);
   perform public.angler_play_receipt('credit',args);perform public.angler_play_receipt('credit',args);
   id:=md5('commercial tip '||i)::uuid;
   begin perform public.angler_market_buy(id,1,100);raise exception 'Pilot paid for enrolled offer';exception when sqlstate 'PT409' then null;end;
   args:=args||jsonb_build_object('offer',id,'revision',1,'price',100);
   wallet:=public.angler_commerce('buy',args);perform public.angler_commerce('buy',args);
   perform pg_temp.check_that(wallet->>'balance'='10','Mixed purchase or replay incorrect');
   perform public.angler_play_receipt('settle',args||'{"net":7025}');
 end loop;
 perform pg_temp.as_user(71);
 wallet:=public.angler_commerce('status');
 perform pg_temp.check_that((wallet->>'earned')::int>=10000 and (wallet->>'published')::int>=3,'Earnings not settled');
 wallet:=public.angler_commerce('payout');
 perform pg_temp.check_that((wallet->>'requested')::int>=10000 and (wallet->>'earned')::int=0,'Payout not reserved');
 perform public.angler_commerce('payout');
 perform pg_temp.check_that((select count(*) from angler_commerce.payouts)=1,'Duplicate payout');
 perform public.angler_play_receipt('void',jsonb_build_object('hash',h));
 perform public.angler_play_receipt('void',jsonb_build_object('hash',h));
 perform pg_temp.as_user(72);
 perform pg_temp.check_that(public.angler_commerce('status')->>'balance'='10'
   and not (public.angler_market_detail(md5('commercial tip 1')::uuid) ? 'technique'),'Refund failed');
 perform pg_temp.check_that((select count(*) from angler_commerce.sales where voided)=1,'Duplicate reversal');
end $$;
update angler_commerce.settings set mode='off';
