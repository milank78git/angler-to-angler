-- General and group mutations share an account lock with verified operator corrections.
-- PostgREST read-only transactions cannot publish anything and do not need this lock.
create or replace function angler_private.verified_subject() returns uuid
language plpgsql volatile set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if current_setting('transaction_read_only')='off' then
    perform pg_advisory_xact_lock_shared(hashtextextended(actor::text,621));
  end if;
  if (public.angler_registration_profile()->>'current')::boolean is not true or
      not exists(select from auth.users where id=actor and email_confirmed_at is not null) then
    raise exception 'Verified age and profile required' using errcode='42501';
  end if;
  return actor;
end $$;
create or replace function angler_groups_private.subject() returns uuid
language plpgsql volatile set search_path='' as $$
declare actor uuid:=angler_private.verified_subject();
begin
  if (select angler_private.age_years(born_on) from angler_private.profiles where user_id=actor)<15 then
    raise exception 'Group permission required' using errcode='42501';
  end if;
  return actor;
end $$;

-- Also enforce this transition on direct operator updates and on pre-age accounts first entering a date.
create function angler_private.apply_birth_date_change() returns trigger
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
  delete from angler_activity.parking_points where creator=person;
  update angler_market.offers set withdrawn=true where seller=person and not withdrawn;
  update angler_market.orders set rating_accuracy=null,rating_technique=null,rating_match=null
    where buyer=person and rating_accuracy is not null;

  -- Object IDs become unreachable immediately; the Storage API sweeper removes old orphans.
  delete from angler_sync.documents where owner=person;
  delete from angler_sync.chunks where owner=person;
  delete from angler_sync.accounts where owner=person;
  delete from angler_sync.usage where owner=person;
  return new;
end $$;
create trigger apply_birth_date_change before update of born_on on angler_private.profiles
  for each row when (old.born_on is distinct from new.born_on) execute function angler_private.apply_birth_date_change();

-- The operator verifies the account holder before invoking this private routine. The old
-- date is a compare-and-set guard against acting on a stale support request.
create function angler_private.correct_birth_date(person uuid,expected date,corrected date) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if corrected is null then raise exception 'Birth date required' using errcode='AN002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(person::text,621));
  update angler_private.profiles set born_on=corrected where user_id=person and born_on is not distinct from expected;
  if not found then raise exception 'Account or date changed' using errcode='PT409'; end if;
end $$;
revoke all on function angler_private.correct_birth_date(uuid,date,date),angler_private.apply_birth_date_change() from public,anon,authenticated;
