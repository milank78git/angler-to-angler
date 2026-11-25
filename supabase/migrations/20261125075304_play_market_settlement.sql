-- Keep pilot balances and historical entitlements outside the CZK ledger.
create schema angler_commerce;
revoke all on schema angler_commerce from public,anon,authenticated;
grant usage on schema angler_commerce to authenticated;
create table angler_commerce.settings (
 singleton boolean primary key default true check(singleton),
 mode text not null default 'off' check(mode in ('off','test','live')),
 bonus_net_halers integer not null default 702 check(bonus_net_halers between 0 and 1000)
);
insert into angler_commerce.settings default values;
create table angler_commerce.lots (
 id bigint generated always as identity primary key,
 holder uuid not null, source text not null check(source in ('welcome','google')),
 units integer not null check(units>0),
 token_hash text unique, order_ref text unique,
 net_halers integer check(net_halers>=0 and net_halers<=units*100),
 settled_at timestamptz, voided boolean not null default false,
 check((source='welcome')=(token_hash is null)),
 check((source='welcome')=(order_ref is null))
);
create unique index one_welcome_per_account on angler_commerce.lots(holder) where source='welcome';
create index credit_owner on angler_commerce.lots(holder,id);
create table angler_commerce.voids (token_hash text primary key, recorded_at timestamptz not null default now());
create table angler_commerce.offers (offer uuid primary key references angler_market.offers(id) on delete cascade);
create table angler_commerce.sales (
 id bigint generated always as identity primary key, buyer uuid not null, author uuid not null,
 offer uuid not null, revision integer not null, price integer not null, voided boolean not null default false,
 created_at timestamptz not null default now()
);
create unique index one_current_sale on angler_commerce.sales(buyer,offer) where not voided;
create index author_sales on angler_commerce.sales(author);
create table angler_commerce.allocations (
 sale bigint not null references angler_commerce.sales(id), lot bigint not null references angler_commerce.lots(id),
 units integer not null check(units>0), primary key(sale,lot)
);
create index fund_allocations on angler_commerce.allocations(lot);
create table angler_commerce.payouts (
 id uuid primary key default gen_random_uuid(), author uuid not null,
 halers bigint not null check(halers>=10000), requested_at timestamptz not null default now(),
 paid_at timestamptz, bank_reference text unique
);
create unique index unresolved_payout on angler_commerce.payouts(author) where paid_at is null;
-- Only private functions can change ledger tables. Disabling the store does not erase history.
do $$declare tbl regclass; begin
 for tbl in select oid::regclass from pg_class where relnamespace='angler_commerce'::regnamespace and relkind='r'
 loop execute format('alter table %s enable row level security',tbl); end loop;
end$$;
revoke all on all tables in schema angler_commerce from public,anon,authenticated;
create view angler_commerce.remaining as
 select l.*, l.units-coalesce((select sum(a.units) from angler_commerce.allocations a
 join angler_commerce.sales s on s.id=a.sale where a.lot=l.id and not s.voided),0) as available
 from angler_commerce.lots l where not l.voided;

-- Cumulative rounding conserves every haler even when a pack is used in many tiny orders.
create view angler_commerce.distribution as
 with running as (
 select s.id,s.author,s.created_at,a.lot,a.units,l.units as pack,l.net_halers,l.settled_at,
 sum(a.units) over(partition by l.id order by s.id) as last_unit
 from angler_commerce.sales s join angler_commerce.allocations a on a.sale=s.id
 join angler_commerce.lots l on l.id=a.lot where not s.voided and not l.voided
 ), amounts as (
 select *,round(net_halers::numeric*last_unit/pack)::bigint as last_net,
 round(net_halers::numeric*(last_unit-units)/pack)::bigint as prev_net from running
 ), splits as (
 select *,round(last_net*0.85)-round(prev_net*0.85) as author_halers,
 round(last_net*0.05)-round(prev_net*0.05) as nature_halers from amounts)
 select id,author,lot,created_at,settled_at,units,author_halers,nature_halers,
 last_net-prev_net-author_halers-nature_halers as platform_halers from splits;
revoke all on angler_commerce.remaining,angler_commerce.distribution from public,anon,authenticated;

create function angler_commerce.welcome() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into angler_commerce.lots(holder,source,units,net_halers,settled_at)
 select new.user_id,'welcome',10,bonus_net_halers,now() from angler_commerce.settings on conflict do nothing;
 return new;
end $$;
create trigger credit_registered_profile after insert on angler_private.profiles
 for each row execute function angler_commerce.welcome();
insert into angler_commerce.lots(holder,source,units,net_halers,settled_at)
 select p.user_id,'welcome',10,s.bonus_net_halers,now() from angler_private.profiles p cross join angler_commerce.settings s;

create function angler_commerce.wallet(actor uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('mode',(select mode from angler_commerce.settings),
 'balance',coalesce((select sum(available) from angler_commerce.remaining where holder=actor),0),
 'earned',coalesce((select sum(author_halers) from angler_commerce.distribution where author=actor),0)
          -coalesce((select sum(halers) from angler_commerce.payouts where author=actor),0),
 'pendingCredits',coalesce((select sum(units) from angler_commerce.distribution where author=actor and settled_at is null),0),
 'requested',coalesce((select halers from angler_commerce.payouts where author=actor and paid_at is null),0),
 'paid',coalesce((select sum(halers) from angler_commerce.payouts where author=actor and paid_at is not null),0),
 'published',(select count(*) from angler_commerce.offers c join angler_market.offers o on c.offer=o.id where o.seller=actor and not o.withdrawn),
 'priorPayout',exists(select from angler_commerce.payouts where author=actor and paid_at is not null))
$$;

-- An older APK can still use pilot offers, but its test wallet can never unlock an enrolled offer.
alter function angler_market.buy(uuid,integer,integer) rename to buy_pilot;
revoke all on function angler_market.buy_pilot(uuid,integer,integer) from public,anon,authenticated;
create function angler_market.buy(offer_id uuid,expected_revision integer,expected_price integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform angler_groups_private.subject();
 perform 1 from angler_market.offers where id=offer_id for update;
 if exists(select from angler_commerce.offers where offer=offer_id) then
   raise exception 'Use the Play marketplace for this offer' using errcode='PT409'; end if;
 return angler_market.buy_pilot(offer_id,expected_revision,expected_price);
end $$;
create or replace function public.angler_market_buy(offer_id uuid,expected_revision integer,expected_price integer)
returns jsonb language sql set search_path='' as $$select angler_market.buy(offer_id,expected_revision,expected_price)$$;
revoke all on function angler_market.buy(uuid,integer,integer) from public,anon;
grant execute on function angler_market.buy(uuid,integer,integer) to authenticated;

create function angler_commerce.market(op text,args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); cfg angler_commerce.settings;
 target uuid:=(args->>'offer')::uuid; o angler_market.offers; v angler_market.versions;
 fund record; sale_id bigint; needed integer; used integer; wallet jsonb;
begin
 select * into strict cfg from angler_commerce.settings;
 if op='status' then return angler_commerce.wallet(actor)||jsonb_build_object('enrolled',
   exists(select from angler_commerce.offers where offer=target)); end if;
 if cfg.mode='off' then raise exception 'Store unavailable' using errcode='PT503'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text,37));
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
   insert into angler_commerce.offers values(target) on conflict do nothing;
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
 for fund in select id,available from angler_commerce.remaining where holder=actor and available>0 order by (source='welcome') desc,id loop
   used:=least(needed,fund.available);
   insert into angler_commerce.allocations values(sale_id,fund.id,used);
   needed:=needed-used; exit when needed=0;
 end loop;
 if needed>0 then raise exception 'Insufficient credits' using errcode='PT402'; end if;
 insert into angler_market.orders(buyer,offer,revision) values(actor,target,v.revision);
 update angler_market.offers set sold=sold+1 where id=target;
 return angler_commerce.wallet(actor);
end $$;
create function public.angler_commerce(op text,args jsonb default '{}') returns jsonb language sql set search_path=''
as $$select angler_commerce.market(op,args)$$;
revoke all on all functions in schema angler_commerce from public,anon,authenticated;
revoke all on function public.angler_commerce(text,jsonb) from public,anon;
grant execute on function public.angler_commerce(text,jsonb),angler_commerce.market(text,jsonb) to authenticated;

-- Backend-only receipt verification, statement reconciliation and void processing.
create function angler_commerce.receipt(op text,args jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare h text:=args->>'hash'; actor uuid; fund angler_commerce.lots; qty integer; item record;
begin
 if h is null or h !~ '^[a-f0-9]{64}$' then raise exception 'Invalid receipt'; end if;
 perform pg_advisory_xact_lock(hashtextextended(h,41));
 select * into fund from angler_commerce.lots where token_hash=h;
 actor:=coalesce(fund.holder,(args->>'holder')::uuid);
 if actor is not null then perform pg_advisory_xact_lock(hashtextextended(actor::text,37)); end if;
 if op='void' then
   insert into angler_commerce.voids values(h,now()) on conflict do nothing;
   if fund.id is not null and not fund.voided then
     update angler_commerce.lots set voided=true where id=fund.id;
     for item in select s.* from angler_commerce.sales s join angler_commerce.allocations a on a.sale=s.id
       where a.lot=fund.id and not s.voided order by s.offer loop
       perform 1 from angler_market.offers where id=item.offer for update;
       update angler_commerce.sales set voided=true where id=item.id;
       delete from angler_market.orders where buyer=item.buyer and offer=item.offer;
       update angler_market.offers set sold=sold-1 where id=item.offer;
     end loop;
   end if;
   return '{}'::jsonb;
 end if;
 if exists(select from angler_commerce.voids where token_hash=h) then raise exception 'Receipt voided'; end if;
 if op='settle' then
   if fund.id is null or args->>'order' is distinct from fund.order_ref or args->>'net' is null then raise exception 'Unknown order'; end if;
   if fund.net_halers is not null and fund.net_halers<>(args->>'net')::integer then raise exception 'Settlement differs'; end if;
   update angler_commerce.lots set net_halers=(args->>'net')::integer,settled_at=coalesce(settled_at,now()) where id=fund.id;
 elsif op='credit' then
   if (select mode from angler_commerce.settings) is distinct from args->>'mode' or args->>'mode' not in ('live','test')
      or args->>'order' is null or length(args->>'order')=0 then raise exception 'Incorrect payment environment'; end if;
   qty:=case args->>'sku' when 'credits_50_czk' then 50 when 'credits_100_czk' then 100 end;
   if qty is null or actor is null or not exists(select from angler_private.profiles where user_id=actor) then raise exception 'Invalid purchase'; end if;
   if fund.id is null then
     insert into angler_commerce.lots(holder,source,units,token_hash,order_ref)
       values(actor,'google',qty,h,args->>'order');
   elsif fund.holder is distinct from (args->>'holder')::uuid or fund.units<>qty or fund.order_ref is distinct from args->>'order' then
     raise exception 'Receipt mismatch';
   end if;
 else raise exception 'Unknown receipt action'; end if;
 return '{}'::jsonb;
end $$;
create function public.angler_play_receipt(op text,args jsonb) returns jsonb language sql security definer set search_path=''
as $$select angler_commerce.receipt(op,args)$$;
revoke all on function angler_commerce.receipt(text,jsonb),public.angler_play_receipt(text,jsonb) from public,anon,authenticated;
grant execute on function public.angler_play_receipt(text,jsonb) to service_role;

-- Explicit enrollment fixes the financial environment for the life of this installation.
alter table angler_commerce.settings add column environment text check(environment in ('test','live'));
create function angler_commerce.keep_environment() returns trigger language plpgsql set search_path='' as $$
begin
 new.environment:=coalesce(old.environment,nullif(new.mode,'off'));
 if new.mode<>'off' and new.environment<>new.mode then raise exception 'Use a separate financial environment'; end if;
 return new;
end $$;
create trigger protect_environment before update on angler_commerce.settings for each row execute function angler_commerce.keep_environment();
revoke all on function angler_commerce.keep_environment() from public,anon,authenticated;
create table angler_commerce.recipients (
 author uuid primary key, provider_reference text not null unique, checked_at timestamptz not null default now()
);
alter table angler_commerce.recipients enable row level security;
create table angler_commerce.nature_transfers (
 bank_reference text primary key, partner text not null, halers bigint not null check(halers>0), paid_at date not null
);
alter table angler_commerce.nature_transfers enable row level security;
revoke all on angler_commerce.recipients,angler_commerce.nature_transfers from public,anon,authenticated;
alter table angler_commerce.payouts add column exported_month date, add column destination text;
