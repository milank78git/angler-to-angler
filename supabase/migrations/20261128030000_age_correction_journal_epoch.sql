create or replace function angler_private.apply_birth_date_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare person uuid:=new.user_id; years integer;
begin
  if new.born_on is null or not isfinite(new.born_on) or new.born_on>(statement_timestamp() at time zone 'Europe/Prague')::date
     or angler_private.age_years(new.born_on)>125 then raise exception 'Invalid birth date' using errcode='AN002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(person::text,621));
  years:=angler_private.age_years(new.born_on);
  if years<18 then
    if exists(select from angler_groups_private.groups where owner_id=person) then
      raise exception 'Resolve group ownership before recording this date' using errcode='PT409';
    end if;
    delete from angler_private.guardians where guardian=person;
  end if;
  if years>=15 or angler_private.age_years(old.born_on)<15 then return new; end if;

  -- Withdraw broad sharing. A child can start sharing inside a group again after verification.
  delete from angler_private.group_permissions where child=person;
  delete from angler_groups_private.catch_posts where author=person;
  delete from angler_groups_private.tips where author_id=person;
  delete from angler_weekly.monthly_members where author=person;
  delete from angler_weekly.votes where voter=person;
  delete from angler_weekly.entries where author=person;
  delete from angler_public_cards.cards where author=person;
  update angler_private.profile_cards set shared=false,revision=revision+1 where user_id=person and shared;
  delete from angler_private.catch_reviewers where user_id=person;
  delete from angler_private.catch_evidence where user_id=person;
  update angler_discussions.posts set body=null,trip_day=null,helpful=false where author_id=person and body is not null;
  delete from angler_discussions.post_watches where owner_id=person;
  delete from angler_public_cards.water_reports where reporter=person;
  delete from angler_activity.trips where author=person;
  delete from angler_activity.water_ratings where author=person;
  delete from angler_activity.parking_reviews where author=person;
  -- Preserve community reviews on shared locations. Lock owned points before
  -- deciding which have no independent contributions (reviews reference them by FK).
  perform from angler_activity.parking_points where creator=person order by id for update;
  delete from angler_activity.parking_points p where p.creator=person
    and not exists(select from angler_activity.parking_reviews r where r.point=p.id);
  update angler_activity.parking_points set
    name=case when editor=person then null else name end,
    creator=case when creator=person then null else creator end,
    editor=case when editor=person then null else editor end
    where creator=person or editor=person;
  update angler_market.offers set withdrawn=true where seller=person and not withdrawn;
  update angler_market.orders set rating_accuracy=null,rating_technique=null,rating_match=null
    where buyer=person and rating_accuracy is not null;

  -- Object IDs become unreachable immediately; the Storage API sweeper removes old orphans.
  perform pg_advisory_xact_lock(hashtextextended(person::text,13));
  delete from angler_sync.documents where owner=person;
  delete from angler_sync.chunks where owner=person;
  delete from angler_sync.photos where owner=person;
  delete from angler_sync.photo_parts where owner=person;
  delete from angler_sync.usage where owner=person;
  -- Previously enabled phones must see PT410 before interpreting an empty document list.
  insert into angler_sync.accounts(owner,erased,epoch) values(person,true,gen_random_uuid())
    on conflict(owner) do update set erased=true,epoch=excluded.epoch,deletion_floor=0;
  return new;
end $$;
