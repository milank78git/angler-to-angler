-- Identify funding from the immutable allocation ledger, including after buyer erasure.
-- The migration changes commercial statistics without revoking access to purchased revisions.
lock table angler_market.offers, angler_market.orders, angler_commerce.offers, angler_commerce.sales in share row exclusive mode;
alter table angler_market.orders add column funding text not null default 'pilot'
  check (funding in ('pilot','welcome','paid'));

with funding as (
  select s.buyer,s.offer,case when bool_or(l.source='google') then 'paid' else 'welcome' end as kind
  from angler_commerce.sales s join angler_commerce.allocations a on a.sale=s.id
  join angler_commerce.lots l on l.id=a.lot where not s.voided group by s.buyer,s.offer
)
update angler_market.orders b set funding=f.kind from funding f
where (b.buyer,b.offer)=(f.buyer,f.offer);

with promotional as (
  select s.offer,count(*) as copies from angler_commerce.sales s
  where not s.voided and not exists (
    select from angler_commerce.allocations a join angler_commerce.lots l on l.id=a.lot
    where a.sale=s.id and l.source='google'
  ) group by s.offer
)
update angler_market.offers o set sold=o.sold-p.copies from promotional p where p.offer=o.id;


-- Pilot copies granted before enrollment still occupy the author's lifetime limit.
-- Keep these separate from paid sales. The ledger survives buyer account erasure.
alter table angler_commerce.offers add column pilot_copies integer not null default 0 check (pilot_copies>=0);
with paid as (
  select s.offer,count(*) as copies from angler_commerce.sales s
  where not s.voided and exists (
    select from angler_commerce.allocations a join angler_commerce.lots l on l.id=a.lot
    where a.sale=s.id and l.source='google'
  ) group by s.offer
)
update angler_commerce.offers c set pilot_copies=o.sold-coalesce(p.copies,0)
from angler_market.offers o left join paid p on p.offer=o.id where c.offer=o.id;

create or replace function angler_market.author_rating(author_id uuid, commercial boolean) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('count',count(*),
    'average',round(avg(b.rating_accuracy+b.rating_technique+b.rating_match)/3,1),
    'accuracy',round(avg(b.rating_accuracy),1),'technique',round(avg(b.rating_technique),1),
    'match',round(avg(b.rating_match),1))
  from angler_market.orders b join angler_market.offers o on o.id=b.offer
  where o.seller=author_id and b.rating_accuracy is not null
    and b.funding=case when commercial then 'paid' else 'pilot' end
$$;

revoke all on function angler_market.author_rating(uuid,boolean) from public,anon,authenticated;

-- A commercial author's public profile shows ratings backed by purchased credits.
create or replace function angler_market.author_rating(author_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select angler_market.author_rating(author_id, exists (
    select from angler_market.offers o join angler_commerce.offers c on c.offer=o.id where o.seller=author_id
  ))
$$;

create or replace function angler_market.rate(offer_id uuid, accuracy integer, technique integer, preview_match integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); purchase angler_market.orders;
begin
  select * into purchase from angler_market.orders where offer=offer_id and buyer=actor for update;
  if not found then raise exception 'Purchase required' using errcode='PT404'; end if;
  if purchase.funding='welcome' or (purchase.funding='pilot' and exists (
    select from angler_commerce.offers c where c.offer=purchase.offer
  )) then raise exception 'Paid purchase required for a commercial rating' using errcode='PT403'; end if;
  if (accuracy between 1 and 5 and technique between 1 and 5 and preview_match between 1 and 5) is not true then
    raise exception 'Each score must be between 1 and 5' using errcode='PT422';
  end if;
  if purchase.rating_accuracy is null then
    update angler_market.orders set rating_accuracy=accuracy,rating_technique=technique,rating_match=preview_match
      where id=purchase.id;
  elsif (purchase.rating_accuracy,purchase.rating_technique,purchase.rating_match)
    is distinct from (accuracy,technique,preview_match) then
    raise exception 'This purchase already has a rating' using errcode='PT409';
  end if;
  return jsonb_build_object('accuracy',accuracy,'technique',technique,'match',preview_match);
end$$;

create or replace function angler_market.detail(offer_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); result jsonb;
begin
 select angler_market.preview(o,v) || jsonb_build_object('mine',o.seller=actor,'purchased',b.id is not null,
   'welcomeOnly',coalesce(b.funding='welcome',false),
   'balance',(select balance from angler_market.wallets where holder=actor)) ||
   case when o.seller=actor or b.id is not null then jsonb_build_object('technique',v.technique) else '{}'::jsonb end ||
   case when b.funding=case when exists(select from angler_commerce.offers c where c.offer=o.id) then 'paid' else 'pilot' end then jsonb_build_object('myRating',case when b.rating_accuracy is not null then
     jsonb_build_object('accuracy',b.rating_accuracy,'technique',b.rating_technique,'match',b.rating_match) end)
     else '{}'::jsonb end
 into result from angler_market.offers o left join angler_market.orders b on b.offer=o.id and b.buyer=actor
 join angler_market.versions v on v.offer=o.id and v.revision=coalesce(b.revision,o.revision)
 where o.id=offer_id and (not o.withdrawn or o.seller=actor or b.id is not null);
 if result is null then raise exception 'Offer unavailable' using errcode='PT404'; end if;
 return result;
end$$;

create or replace function angler_market.preview(o angler_market.offers, v angler_market.versions) returns jsonb
language sql stable set search_path='' as $$
 with enrollment as (select (select c.pilot_copies from angler_commerce.offers c where c.offer=o.id) as pilot_copies)
 select jsonb_build_object('id',o.id,'revision',v.revision,'title',v.title,'species',v.species,'day',v.trip_day,
   'access',v.access,'water',v.water,'price',v.price,'limit',v.sale_limit,'sold',o.sold,
   'commercial',pilot_copies is not null,'sales',o.sold-coalesce(pilot_copies,0),'pilotCopies',coalesce(pilot_copies,0),'withdrawn',o.withdrawn,
   'offerRating',(select jsonb_build_object('count',count(*),'average',round(avg(r.rating_accuracy+r.rating_technique+r.rating_match)/3,1))
                  from angler_market.orders r where r.offer=o.id and r.rating_accuracy is not null
                    and r.funding=case when pilot_copies is not null then 'paid' else 'pilot' end),
   'authorRating',angler_market.author_rating(o.seller,pilot_copies is not null),
   'author',(select display_name from angler_private.profiles where user_id=o.seller)) from enrollment
$$;

create or replace function angler_commerce.discover(water_key text, before_position bigint,commercial boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject();
begin
 return (with live as materialized (
   select o.id,o.position,o.seller,o.sold-coalesce(c.pilot_copies,0) as sales,o.revision
   from angler_market.offers o join angler_market.versions v on (v.offer,v.revision)=(o.id,o.revision)
   left join angler_commerce.offers c on c.offer=o.id
   where (c.offer is not null)=commercial
     and not o.withdrawn and (v.sale_limit is null or o.sold<v.sale_limit) and (water_key is null or v.water=water_key)),
 batch as (select * from live where before_position is null or position<before_position order by position desc limit 21),
 shown as (select * from batch order by position desc limit 20)
 select jsonb_build_object('items',coalesce((select jsonb_agg(angler_market.preview(o,v) order by s.position desc)
  from shown s join angler_market.offers o on o.id=s.id join angler_market.versions v on (v.offer,v.revision)=(s.id,s.revision)),'[]'::jsonb),
  'balance',(select balance from angler_market.wallets where holder=actor),
  'next',case when (select count(*) from batch)>20 then (select min(position)::text from shown) end,
  'stats',jsonb_build_object('offers',count(*),'authors',count(distinct seller),'sales',coalesce(sum(sales),0),
    'ratings',(select count(*) from angler_market.orders r join live l on l.id=r.offer where r.rating_accuracy is not null
      and r.funding=case when commercial then 'paid' else 'pilot' end))) from live);
end$$;

create or replace function angler_commerce.market(op text,args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); cfg angler_commerce.settings;
 target uuid:=(args->>'offer')::uuid; o angler_market.offers; v angler_market.versions;
 fund record; sale_id bigint; needed integer; used integer; paid_units integer:=0; welcome_available integer; wallet jsonb;
begin
 select * into strict cfg from angler_commerce.settings;
 if op='status' then return angler_commerce.wallet(actor)||jsonb_build_object(
   'welcomeBalance',coalesce((select sum(available) from angler_commerce.remaining where holder=actor and source='welcome'),0),
   'enrolled',
   exists(select from angler_commerce.offers where offer=target)); end if;
 if op='discover' then
   return angler_commerce.discover(args->>'water',(args->>'cursor')::bigint,true);
 end if;
 if cfg.mode='off' then raise exception 'Store unavailable' using errcode='PT503'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,37));
 if op='publish' then
   if (args->>'expected_revision')::int is distinct from 0 then raise exception 'Expected a new offer' using errcode='PT422'; end if;
   target:=(args->>'offer_id')::uuid;
   wallet:=public.angler_market_publish(target,0,args->'draft');
   insert into angler_commerce.offers(offer,pilot_copies)
     select id,sold from angler_market.offers where id=target on conflict do nothing;
   return wallet;
 end if;
 if op='payout' then
   wallet:=angler_commerce.wallet(actor);
   if (wallet->>'requested')::numeric>0 then return wallet; end if;
   if (wallet->>'earned')::numeric<10000 or (not (wallet->>'priorPayout')::boolean and (wallet->>'published')::int<3)
     then raise exception 'Payout threshold not met' using errcode='PT422'; end if;
   insert into angler_commerce.payouts(author,halers) values(actor,(wallet->>'earned')::bigint);
   return angler_commerce.wallet(actor);
 end if;
 select * into o from angler_market.offers where id=target for update;
 if not found then raise exception 'Offer unavailable' using errcode='PT404'; end if;
 if op='enroll' then
   if o.seller<>actor or o.withdrawn or o.revision is distinct from (args->>'revision')::int then
     raise exception 'Offer changed' using errcode='PT409'; end if;
   insert into angler_commerce.offers(offer,pilot_copies) values(target,o.sold) on conflict do nothing;
   return jsonb_build_object('enrolled',true);
 end if;
 if op is distinct from 'buy' or o.seller=actor or not exists(select from angler_commerce.offers where offer=target)
   then raise exception 'Ineligible purchase' using errcode='42501'; end if;
 if exists(select from angler_market.orders where buyer=actor and offer=target) then return angler_commerce.wallet(actor); end if;
 select * into strict v from angler_market.versions where offer=target and revision=o.revision;
 if o.withdrawn or v.revision is distinct from (args->>'revision')::int or v.price is distinct from (args->>'price')::int or o.sold>=v.sale_limit
   then raise exception 'Offer changed' using errcode='PT409'; end if;
 insert into angler_commerce.sales(buyer,author,offer,revision,price) values(actor,o.seller,target,v.revision,v.price) returning id into sale_id;
 needed:=v.price;
 select coalesce(sum(available),0) into welcome_available from angler_commerce.remaining where holder=actor and source='welcome';
 for fund in select id,source,available from angler_commerce.remaining where holder=actor and available>0 order by (source='welcome') desc,id loop
   -- Unlimited previews may be fully promotional. A limited copy requires a paid unit.
   used:=least(needed,fund.available);
   if fund.source='welcome' and v.sale_limit is not null then used:=least(used,needed-1); end if;
   if used=0 then continue; end if;
   if fund.source='google' then paid_units:=paid_units+used; end if;
   insert into angler_commerce.allocations values(sale_id,fund.id,used);
   needed:=needed-used; exit when needed=0;
 end loop;
 if needed>0 then raise exception 'Insufficient credits' using errcode='PT402'; end if;
 -- Confirm the displayed paid amount under the wallet lock. Older clients may
 -- still buy when the new inventory rule does not increase their paid spend.
 if (args ? 'paid' and (args->>'paid')::integer is distinct from paid_units)
   or (not (args ? 'paid') and paid_units>greatest(0,v.price-welcome_available)) then
   raise exception 'Purchase funding changed' using errcode='PT409';
 end if;
 insert into angler_market.orders(buyer,offer,revision,funding)
 values(actor,target,v.revision,case when paid_units>0 then 'paid' else 'welcome' end);
 if paid_units>0 then update angler_market.offers set sold=sold+1 where id=target; end if;
 return angler_commerce.wallet(actor);
end $$;
