-- Each purchase already identifies its buyer and immutable offer version.
alter table angler_market.orders
  add column rating_accuracy smallint,
  add column rating_technique smallint,
  add column rating_match smallint,
  add constraint complete_tip_rating check (
    num_nonnulls(rating_accuracy,rating_technique,rating_match)=0 or
    (buyer is not null and num_nonnulls(rating_accuracy,rating_technique,rating_match)=3 and
      rating_accuracy between 1 and 5 and rating_technique between 1 and 5 and rating_match between 1 and 5));
create index market_rated_offer on angler_market.orders(offer)
  include(rating_accuracy,rating_technique,rating_match) where rating_accuracy is not null;

-- The existing FK anonymizes orders on buyer erasure. Remove the scores in that same update.
create function angler_market.clear_erased_rating() returns trigger
language plpgsql set search_path='' as $$
begin
  new.rating_accuracy:=null;
  new.rating_technique:=null;
  new.rating_match:=null;
  return new;
end$$;
create trigger erase_buyer_rating before update of buyer on angler_market.orders
  for each row when (new.buyer is null and old.rating_accuracy is not null)
  execute function angler_market.clear_erased_rating();
revoke all on function angler_market.clear_erased_rating() from public,anon,authenticated;

-- Aggregate purchases across every offer from this author, including withdrawn offers.
-- Round only after combining all scores, so each purchase has equal weight.
create function angler_market.author_rating(author_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('count',count(*),
    'average',round(avg(b.rating_accuracy+b.rating_technique+b.rating_match)/3,1),
    'accuracy',round(avg(b.rating_accuracy),1),'technique',round(avg(b.rating_technique),1),
    'match',round(avg(b.rating_match),1))
  from angler_market.orders b join angler_market.offers o on o.id=b.offer
  where o.seller=author_id and b.rating_accuracy is not null
$$;
revoke all on function angler_market.author_rating(uuid) from public,anon,authenticated;

-- Lock the buyer's purchase, independent of current offer availability or price.
-- A repeated submission returns its original receipt. A competing different vote cannot replace it.
create function angler_market.rate(offer_id uuid, accuracy integer, technique integer, preview_match integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); purchase angler_market.orders;
begin
  select * into purchase from angler_market.orders where offer=offer_id and buyer=actor for update;
  if not found then raise exception 'Purchase required' using errcode='PT404'; end if;
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
create function public.angler_market_rate(offer_id uuid,accuracy integer,technique integer,preview_match integer)
returns jsonb language sql security invoker set search_path='' as $$
  select angler_market.rate(offer_id,accuracy,technique,preview_match)
$$;
revoke all on function public.angler_market_rate(uuid,integer,integer,integer),
  angler_market.rate(uuid,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.angler_market_rate(uuid,integer,integer,integer),
  angler_market.rate(uuid,integer,integer,integer) to authenticated;

create or replace function angler_market.preview(o angler_market.offers, v angler_market.versions) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',o.id,'revision',v.revision,'title',v.title,'species',v.species,'day',v.trip_day,
   'access',v.access,'water',v.water,'price',v.price,'limit',v.sale_limit,'sold',o.sold,'withdrawn',o.withdrawn,
   'authorRating',angler_market.author_rating(o.seller),
   'author',(select display_name from angler_private.profiles where user_id=o.seller))
$$;

create or replace function angler_market.detail(offer_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); result jsonb;
begin
 select angler_market.preview(o,v) || jsonb_build_object('mine',o.seller=actor,'purchased',b.id is not null,
   'balance',(select balance from angler_market.wallets where holder=actor)) ||
   case when o.seller=actor or b.id is not null then jsonb_build_object('technique',v.technique) else '{}'::jsonb end ||
   case when b.id is not null then jsonb_build_object('myRating',case when b.rating_accuracy is not null then
     jsonb_build_object('accuracy',b.rating_accuracy,'technique',b.rating_technique,'match',b.rating_match) end)
     else '{}'::jsonb end
 into result from angler_market.offers o left join angler_market.orders b on b.offer=o.id and b.buyer=actor
 join angler_market.versions v on v.offer=o.id and v.revision=coalesce(b.revision,o.revision)
 where o.id=offer_id and (not o.withdrawn or o.seller=actor or b.id is not null);
 if result is null then raise exception 'Offer unavailable' using errcode='PT404'; end if;
 return result;
end$$;

create or replace function angler_groups_private.card(profile_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := angler_groups_private.subject(); target uuid := coalesce(profile_id, actor); result jsonb;
begin
  select jsonb_build_object(
    'id',p.user_id,'name',p.display_name,'hometown',coalesce(c.hometown,''),
    'tagline',coalesce(c.tagline,''),'biography',coalesce(c.biography,''),
    'avatar',coalesce(c.avatar_id,0),'photo',replace(encode(c.photo,'base64'),chr(10),''),
    'shared',coalesce(c.shared,false),'revision',case when target=actor then coalesce(c.revision,0) end,
    'authorRating',angler_market.author_rating(target),
    'verifiedCount',(select count(*) from angler_private.catch_evidence e where e.user_id=target and e.outcome in ('measured','estimated')),
    'groups',coalesce((select jsonb_agg(g.name order by g.name,g.id)
      from angler_groups_private.groups g
      where (g.owner_id=target or exists(select from angler_groups_private.members m where m.group_id=g.id and m.user_id=target))
        and (target=actor or g.owner_id=actor or exists(select from angler_groups_private.members m where m.group_id=g.id and m.user_id=actor))
    ),'[]'::jsonb)
  ) into result from angler_private.profiles p left join angler_private.profile_cards c on c.user_id=p.user_id
  where p.user_id=target and (target=actor or c.shared);
  if result is null then raise exception 'Profile unavailable' using errcode='PT404'; end if;
  return result;
end;
$$;
