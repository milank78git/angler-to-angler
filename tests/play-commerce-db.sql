create role service_role;
\ir ../supabase/migrations/20261125075304_play_market_settlement.sql
\ir ../supabase/migrations/20261125153337_promotional_credits.sql
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
   if i=1 then
     perform public.angler_market_publish(id,0,draft);
     perform public.angler_commerce('enroll',jsonb_build_object('offer',id,'revision',1));
   else
     perform public.angler_commerce('publish',jsonb_build_object('offer_id',id,'expected_revision',0,'draft',draft));
   end if;
   perform pg_temp.check_that(exists(select from jsonb_array_elements(public.angler_commerce('discover')->'items') item where item->>'id'=id::text)
     and not exists(select from jsonb_array_elements(public.angler_market_discover()->'items') item where item->>'id'=id::text),'Offer listed in wrong store');
 end loop;
 for i in 1..2 loop
   perform pg_temp.as_user(71+i);buyer:=auth.uid();
   perform pg_temp.check_that(public.angler_play_receipt('holder',jsonb_build_object('binding',encode(sha256(convert_to(buyer::text,'UTF8')),'hex')))->>'holder'=buyer::text,
     'Push purchase did not resolve the profile');
   args:=jsonb_build_object('holder',buyer,'sku','credits_100_czk','mode','test','order','fixture-order-'||i,'hash',case i when 1 then h else h2 end);
   perform public.angler_play_receipt('credit',args);perform public.angler_play_receipt('credit',args);
   id:=md5('commercial tip '||i)::uuid;
   begin perform public.angler_market_buy(id,1,100);raise exception 'Pilot paid for enrolled offer';exception when sqlstate 'PT409' then null;end;
   args:=args||jsonb_build_object('offer',id,'revision',1,'price',100);
   wallet:=public.angler_commerce('buy',args);perform public.angler_commerce('buy',args);
   perform pg_temp.check_that(wallet->>'balance'='10','Mixed purchase or replay incorrect');
   perform pg_temp.as_user(71);
   wallet:=public.angler_commerce('status');
   perform pg_temp.check_that((wallet->>'pendingCredits')::int=90
     and (wallet->>'earned')::int=(i-1)*5375,'Only settled paid units fund earnings');
   perform public.angler_play_receipt('settle',args||'{"net":7025}');
 end loop;
 -- A normal promotional purchase unlocks the content without changing any cash allocation.
 perform pg_temp.as_user(71);
 id:=md5('promotional tip')::uuid;
 perform public.angler_commerce('publish',jsonb_build_object('offer_id',id,'expected_revision',0,'draft',draft||'{"price":10}'));
 perform pg_temp.as_user(74);
 wallet:=public.angler_commerce('buy',jsonb_build_object('offer',id,'revision',1,'price',10));
 perform pg_temp.check_that(wallet->>'balance'='0' and public.angler_market_detail(id)->>'technique'='Use a slow retrieve',
   'Promotional units did not unlock the tip');
 perform pg_temp.check_that((select sum(d.author_halers+d.nature_halers+d.platform_halers)
   from angler_commerce.distribution d join angler_commerce.sales s on s.id=d.id where s.offer=md5('promotional tip')::uuid)=0,
   'Promotional purchase generated cash');
 perform pg_temp.as_user(71);
 wallet:=public.angler_commerce('status');
 perform pg_temp.check_that((wallet->>'earned')::int=10750 and (wallet->>'published')::int>=3,'Earnings not settled');
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
\ir ../supabase/migrations/20261125154111_purchased_tip_retention.sql
-- Exercise real seller erasure and the refund path without altering fixtures used by later tests.
savepoint seller_erasure;
delete from auth.users where id='00000000-0000-4000-8000-000000000071';
set local role authenticated;
select pg_temp.as_user(73);
do $$declare id uuid:=md5('commercial tip 2')::uuid; item jsonb; begin
  item:=public.angler_market_detail(id);
  perform pg_temp.check_that(item->>'technique'='Use a slow retrieve' and (item->>'withdrawn')::boolean
    and item->>'author' is null and (item->>'purchased')::boolean,'Buyer lost purchased revision');
  perform pg_temp.check_that(exists(select from jsonb_array_elements(public.angler_market_list('purchased')->'items') row
    where row->>'id'=id::text),'Missing from purchased shelf');
  perform pg_temp.as_user(74);
  begin perform public.angler_market_detail(id); raise exception 'Withdrawn tip visible';
    exception when sqlstate 'PT404' then null; end;
end $$;
reset role;
select public.angler_play_receipt('void',jsonb_build_object('hash',repeat('a',64)));
select pg_temp.check_that(not exists(select from angler_market.offers where id=md5('commercial tip 2')::uuid),
  'Archived content retained after final refund');
rollback to seller_erasure;

-- Existing sales were created under the original allocation rules. Retain their
-- purchased revisions and separate promotional activity from commercial totals.
update angler_market.orders set rating_accuracy=5,rating_technique=5,rating_match=5
  where offer=md5('promotional tip')::uuid;
\ir ../supabase/migrations/20261125165309_market_purchase_funding.sql
update angler_commerce.settings set mode='test';
select pg_temp.as_user(74);
do $$declare item jsonb:=public.angler_market_detail(md5('promotional tip')::uuid); begin
  perform pg_temp.check_that(item->>'technique'='Use a slow retrieve' and item->>'sold'='0'
    and not (item ? 'myRating') and item#>>'{offerRating,count}'='0' and item#>>'{authorRating,count}'='0',
    'Historic promotional access or commercial totals incorrect');
  begin perform public.angler_market_rate(md5('promotional tip')::uuid,4,4,4);
    raise exception 'Promotional unlock can rate'; exception when sqlstate 'PT403' then null; end;
end $$;
select pg_temp.as_user(73);
select public.angler_market_rate(md5('commercial tip 2')::uuid,4,4,4);
select pg_temp.check_that(public.angler_commerce('discover')#>>'{stats,ratings}'='1'
  and public.angler_market_detail(md5('commercial tip 2')::uuid)#>>'{authorRating,average}'='4.0',
  'Historical mixed purchase missing from commercial ratings');

do $$declare limited uuid:=md5('limited funding fixture')::uuid; unlimited uuid:=md5('unlimited funding fixture')::uuid;
  draft jsonb:='{"title":"Retrieve speed","species":"Pike","access":"shore","day":"2026-01-01","water":null,"technique":"Use a slow retrieve","price":6,"limit":1}';
  args jsonb; wallet jsonb; receipt jsonb;
begin
  perform pg_temp.as_user(71);
  perform public.angler_commerce('publish',jsonb_build_object('offer_id',limited,'expected_revision',0,'draft',draft));
  perform public.angler_commerce('publish',jsonb_build_object('offer_id',unlimited,'expected_revision',0,'draft',draft||'{"price":2,"limit":null}'));
  perform pg_temp.as_user(72);
  args:=jsonb_build_object('offer',unlimited,'revision',1,'price',2,'paid',0);
  wallet:=public.angler_commerce('buy',args);
  perform pg_temp.check_that(wallet->>'balance'='8' and public.angler_market_detail(unlimited)->>'sold'='0'
    and not (public.angler_market_detail(unlimited) ? 'myRating'),'Welcome-only unlock counted as a sale');
  args:=jsonb_build_object('offer',limited,'revision',1,'price',6);
  begin perform public.angler_commerce('buy',args||'{"paid":1}'); raise exception 'Limited copy used no paid credit';
    exception when sqlstate 'PT402' then null; end;
  receipt:=jsonb_build_object('holder',auth.uid(),'sku','credits_50_czk','mode','test','order','limited-funding-fixture','hash',repeat('c',64));
  perform public.angler_play_receipt('credit',receipt);
  begin perform public.angler_commerce('buy',args); raise exception 'Legacy confirmation charged extra paid credits';
    exception when sqlstate 'PT409' then null; end;
  begin perform public.angler_commerce('buy',args||'{"paid":2}'); raise exception 'Changed quote accepted';
    exception when sqlstate 'PT409' then null; end;
  wallet:=public.angler_commerce('buy',args||'{"paid":1}');
  perform public.angler_commerce('buy',args||'{"paid":1}');
  perform pg_temp.check_that(wallet->>'balance'='52' and public.angler_commerce('status')->>'welcomeBalance'='3'
    and public.angler_market_detail(limited)->>'sold'='1','Mixed reservation or retry incorrect');
  perform public.angler_market_rate(limited,5,4,3);
  perform pg_temp.as_user(73);
  begin perform public.angler_commerce('buy',args); raise exception 'Sold out offer unlocked';
    exception when sqlstate 'PT409' then null; end;
  perform public.angler_play_receipt('void',receipt);
  perform pg_temp.check_that(public.angler_market_detail(limited)->>'sold'='0' and
    public.angler_market_detail(limited)#>>'{offerRating,count}'='0','Refund did not release stock and rating');
  wallet:=public.angler_commerce('buy',args||'{"paid":6}');
  perform pg_temp.check_that(wallet->>'balance'='4' and public.angler_market_detail(limited)->>'sold'='1',
    'Paid-only purchase after refund failed');
end $$;
update angler_commerce.settings set mode='off';
