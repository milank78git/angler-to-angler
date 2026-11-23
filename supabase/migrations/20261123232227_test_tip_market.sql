-- Pilot technique offers. Test credits cannot be bought, transferred or redeemed.
create schema angler_market;
revoke all on schema angler_market from public, anon, authenticated;
grant usage on schema angler_market to authenticated;

create table angler_market.wallets (
  holder uuid primary key references angler_private.profiles(user_id) on delete cascade,
  balance integer not null default 100 check (balance between 0 and 100)
);
create table angler_market.offers (
  id uuid primary key,
  seller uuid not null references angler_private.profiles(user_id) on delete cascade,
  position bigint generated always as identity unique,
  revision integer not null default 1,
  withdrawn boolean not null default false,
  sold integer not null default 0 check (sold >= 0)
);
create index market_owner_list on angler_market.offers(seller, position desc);
create table angler_market.versions (
  offer uuid not null references angler_market.offers(id) on delete cascade,
  revision integer not null,
  title text not null check (length(title) between 1 and 80),
  species text not null check (length(species) between 1 and 60),
  access text not null check (access in ('shore','boat','both')),
  trip_day date not null,
  water text references angler_public_cards.waters(key),
  technique text not null check (length(technique) between 10 and 2000),
  price integer not null check (price between 1 and 100),
  sale_limit integer check (sale_limit between 1 and 10000),
  primary key (offer, revision)
);
-- Erasing a buyer removes attribution, while preserving the author's sale and lifetime limit.
create table angler_market.orders (
  id bigint generated always as identity primary key,
  buyer uuid references angler_private.profiles(user_id) on delete set null,
  offer uuid not null, revision integer not null,
  foreign key (offer, revision) references angler_market.versions(offer, revision) on delete cascade,
  unique (offer, buyer)
);
create index market_buyer_orders on angler_market.orders(buyer, offer);
alter table angler_market.wallets enable row level security;
alter table angler_market.offers enable row level security;
alter table angler_market.versions enable row level security;
alter table angler_market.orders enable row level security;
revoke all on all tables in schema angler_market from public,anon,authenticated;

-- Caller selects the entitled revision. The preview never serializes private version rows.
create function angler_market.preview(o angler_market.offers, v angler_market.versions) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',o.id,'revision',v.revision,'title',v.title,'species',v.species,'day',v.trip_day,
   'access',v.access,'water',v.water,'price',v.price,'limit',v.sale_limit,'sold',o.sold,'withdrawn',o.withdrawn,
   'author',(select display_name from angler_private.profiles where user_id=o.seller))
$$;
create function angler_market.list_items(shelf text, before_position bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject();
begin
 if shelf is null or shelf not in ('browse','mine','purchased') then raise exception 'Unknown shelf' using errcode='PT422'; end if;
 return (with batch as (
   select o.position,angler_market.preview(o,v) as item
   from angler_market.offers o left join angler_market.orders b on b.offer=o.id and b.buyer=actor
   join angler_market.versions v on v.offer=o.id and v.revision=case when shelf='purchased' then b.revision else o.revision end
   where (before_position is null or o.position<before_position)
    and case shelf when 'mine' then o.seller=actor when 'purchased' then b.id is not null
        else not o.withdrawn and (v.sale_limit is null or o.sold<v.sale_limit) and o.seller<>actor and b.id is null end
   order by o.position desc limit 21),
   shown as (select * from batch order by position desc limit 20)
   select jsonb_build_object('items',coalesce(jsonb_agg(item order by position desc),'[]'::jsonb),
     'next',case when (select count(*) from batch)>20 then min(position)::text end,
     'balance',(select balance from angler_market.wallets where holder=actor)) from shown);
end$$;

create function angler_market.detail(offer_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); result jsonb;
begin
 select angler_market.preview(o,v) || jsonb_build_object('mine',o.seller=actor,'purchased',b.id is not null,
   'balance',(select balance from angler_market.wallets where holder=actor)) ||
   case when o.seller=actor or b.id is not null then jsonb_build_object('technique',v.technique) else '{}'::jsonb end
 into result from angler_market.offers o left join angler_market.orders b on b.offer=o.id and b.buyer=actor
 join angler_market.versions v on v.offer=o.id and v.revision=coalesce(b.revision,o.revision)
 where o.id=offer_id and (not o.withdrawn or o.seller=actor or b.id is not null);
 if result is null then raise exception 'Offer unavailable' using errcode='PT404'; end if;
 return result;
end$$;

create function angler_market.activate() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject();
begin
 insert into angler_market.wallets(holder) values(actor) on conflict do nothing;
 return jsonb_build_object('balance',(select balance from angler_market.wallets where holder=actor));
end$$;

create function angler_market.publish(offer_id uuid, expected_revision integer, draft jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); o angler_market.offers; v angler_market.versions;
  new_offer boolean:=false; prior angler_market.versions;
begin
 if offer_id is null or expected_revision is null or expected_revision<0 or jsonb_typeof(draft) is distinct from 'object'
   or length(draft::text)>16000 then raise exception 'Invalid offer' using errcode='PT422'; end if;
 v.title:=btrim(draft->>'title'); v.species:=btrim(draft->>'species'); v.access:=draft->>'access';
 v.water:=draft->>'water'; v.trip_day:=(draft->>'day')::date; v.technique:=btrim(draft->>'technique');
 v.price:=(draft->>'price')::integer; v.sale_limit:=(draft->>'limit')::integer;
 if (v.trip_day between date '1900-01-01' and (now() at time zone 'Europe/Prague')::date
    and length(v.title) between 1 and 80 and length(v.species) between 1 and 60
    and length(v.technique) between 10 and 2000 and v.access in ('shore','boat','both')
    and v.price between 1 and 100 and (v.sale_limit is null or v.sale_limit between 1 and 10000)) is not true
    or (v.water is not null and not exists(select from angler_public_cards.waters where key=v.water))
    or draft<>jsonb_build_object('title',v.title,'species',v.species,'access',v.access,'day',v.trip_day,
       'water',v.water,'technique',v.technique,'price',v.price,'limit',v.sale_limit)
 then raise exception 'Invalid technique offer' using errcode='PT422'; end if;
 if expected_revision=0 then
   insert into angler_market.offers(id,seller) values(offer_id,actor) on conflict do nothing returning * into o;
   new_offer:=found;
 end if;
 if not new_offer then
   select * into o from angler_market.offers where id=offer_id and seller=actor for update;
   if not found or o.withdrawn then raise exception 'Offer unavailable' using errcode='PT404'; end if;
   select * into prior from angler_market.versions where offer=offer_id and revision=o.revision;
   v.offer:=offer_id; v.revision:=o.revision;
   if expected_revision in (o.revision,o.revision-1) and prior is not distinct from v then
     return jsonb_build_object('id',o.id,'revision',o.revision);
   end if;
   if o.revision<>expected_revision or v.sale_limit<o.sold then raise exception 'Offer changed' using errcode='PT409'; end if;
   update angler_market.offers set revision=revision+1 where id=offer_id returning * into o;
 end if;
 v.offer:=offer_id; v.revision:=o.revision;
 insert into angler_market.versions select v.*;
 return jsonb_build_object('id',o.id,'revision',o.revision);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
 raise exception 'Invalid offer value' using errcode='PT422';
end$$;

-- Serialize stock per offer, then debit the wallet conditionally. Every change rolls back on failure.
create function angler_market.buy(offer_id uuid, expected_revision integer, expected_price integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); o angler_market.offers; v angler_market.versions; bought integer;
begin
 select * into o from angler_market.offers where id=offer_id for update;
 if not found then raise exception 'Unavailable' using errcode='PT404'; end if;
 select revision into bought from angler_market.orders where buyer=actor and offer=offer_id;
 if found then return jsonb_build_object('revision',bought); end if;
 if o.seller=actor then raise exception 'Own offer' using errcode='42501'; end if;
 select * into strict v from angler_market.versions where offer=offer_id and revision=o.revision;
 if o.withdrawn or v.revision is distinct from expected_revision or v.price is distinct from expected_price
     or o.sold>=v.sale_limit then raise exception 'Offer changed' using errcode='PT409'; end if;
 update angler_market.wallets set balance=balance-v.price where holder=actor and balance>=v.price;
 if not found then raise exception 'Insufficient test credits' using errcode='PT402'; end if;
 insert into angler_market.orders(buyer,offer,revision) values(actor,offer_id,v.revision);
 update angler_market.offers set sold=sold+1 where id=offer_id;
 return jsonb_build_object('revision',v.revision);
end$$;
create function angler_market.withdraw(offer_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject();
begin
 update angler_market.offers set withdrawn=true where id=offer_id and seller=actor;
 if not found then raise exception 'Unavailable' using errcode='PT404'; end if;
 return '{}'::jsonb;
end$$;

revoke all on all functions in schema angler_market from public,anon,authenticated;
create function public.angler_market_list(shelf text, before_position bigint default null) returns jsonb
language sql stable security invoker set search_path='' as $$select angler_market.list_items(shelf, before_position)$$;
revoke all on function public.angler_market_list(text, bigint) from public,anon,authenticated;
grant execute on function public.angler_market_list(text, bigint), angler_market.list_items(text, bigint) to authenticated;
create function public.angler_market_detail(offer_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select angler_market.detail(offer_id)$$;
revoke all on function public.angler_market_detail(uuid) from public,anon,authenticated;
grant execute on function public.angler_market_detail(uuid), angler_market.detail(uuid) to authenticated;
create function public.angler_market_activate() returns jsonb
language sql security invoker set search_path='' as $$select angler_market.activate()$$;
revoke all on function public.angler_market_activate() from public,anon,authenticated;
grant execute on function public.angler_market_activate(), angler_market.activate() to authenticated;
create function public.angler_market_publish(offer_id uuid, expected_revision integer, draft jsonb) returns jsonb
language sql security invoker set search_path='' as $$select angler_market.publish(offer_id, expected_revision, draft)$$;
revoke all on function public.angler_market_publish(uuid, integer, jsonb) from public,anon,authenticated;
grant execute on function public.angler_market_publish(uuid, integer, jsonb), angler_market.publish(uuid, integer, jsonb) to authenticated;
create function public.angler_market_buy(offer_id uuid, expected_revision integer, expected_price integer) returns jsonb
language sql security invoker set search_path='' as $$select angler_market.buy(offer_id, expected_revision, expected_price)$$;
revoke all on function public.angler_market_buy(uuid, integer, integer) from public,anon,authenticated;
grant execute on function public.angler_market_buy(uuid, integer, integer), angler_market.buy(uuid, integer, integer) to authenticated;
create function public.angler_market_withdraw(offer_id uuid) returns jsonb
language sql security invoker set search_path='' as $$select angler_market.withdraw(offer_id)$$;
revoke all on function public.angler_market_withdraw(uuid) from public,anon,authenticated;
grant execute on function public.angler_market_withdraw(uuid), angler_market.withdraw(uuid) to authenticated;
