-- Keep only the purchased revisions accessible to their remaining buyers.
alter table angler_market.offers alter column seller drop not null;
alter table angler_market.offers add constraint archived_offers_are_withdrawn
  check (seller is not null or withdrawn);

create function angler_market.prune_archived_tip(target uuid) returns void
language plpgsql set search_path='' as $$
declare last_revision integer;
begin
  perform 1 from angler_market.offers where id=target and seller is null for update;
  if not found then return; end if;
  select max(revision) into last_revision from angler_market.orders
    where offer=target and buyer is not null;
  if last_revision is null then
    delete from angler_market.offers where id=target;
    return;
  end if;
  update angler_market.offers set revision=last_revision where id=target and revision<>last_revision;
  delete from angler_market.versions v where v.offer=target and not exists (
    select from angler_market.orders b where b.offer=target and b.revision=v.revision and b.buyer is not null
  );
end $$;

create function angler_market.archive_seller_tips() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  -- Lock in the same place as the buy API before checking the final set of orders.
  for target in select id from angler_market.offers where seller=old.user_id order by id for update loop
    if exists (select from angler_market.orders where offer=target and buyer is not null) then
      update angler_market.offers set seller=null,withdrawn=true where id=target;
      perform angler_market.prune_archived_tip(target);
    end if;
  end loop;
  -- Offers without buyers still follow the existing ON DELETE CASCADE.
  return old;
end $$;
create trigger archive_purchased_tips before delete on angler_private.profiles
  for each row execute function angler_market.archive_seller_tips();

create function angler_market.release_archived_tip() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform angler_market.prune_archived_tip(old.offer);
  return null;
end $$;
create trigger release_erased_buyer after update of buyer on angler_market.orders
  for each row when (old.buyer is not null and new.buyer is null)
  execute function angler_market.release_archived_tip();
create trigger release_refunded_buyer after delete on angler_market.orders
  for each row when (old.buyer is not null) execute function angler_market.release_archived_tip();
revoke all on function angler_market.prune_archived_tip(uuid), angler_market.archive_seller_tips(),
  angler_market.release_archived_tip() from public,anon,authenticated;
