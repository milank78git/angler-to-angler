-- Preserve the stored pilot keys and revisions. Old and new clients must count
-- the same fish in one statistical cell, even when they use different wire keys.
alter table angler_activity.trips alter column target type text using target::text;

-- Only catalogue names and the original activity choices are accepted. Reuse
-- the market's published alias mapping for the four historical species.
create function angler_activity.target_key(value text) returns text
language plpgsql stable strict security invoker set search_path='' as $$
declare legacy text;
begin
  if value in ('unspecified','other','pike','zander','barbel','roach') then return value; end if;
  if not exists (select from angler_market.species where latin=value) then
    raise exception 'Unknown target species' using errcode='PT422';
  end if;
  select alias into legacy from angler_market.species_alias
    where latin=value and alias in ('pike','zander','barbel','roach');
  return coalesce(legacy,value);
end $$;

-- Lock the owner's row before comparing revisions. A lost receipt can be replayed but an old
-- write can never revive a subsequently withdrawn contribution or replace a newer snapshot.
create function angler_activity.change(id uuid,expected int,w text,m date,s text,
  k angler_activity.method,n int) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); r angler_activity.trips;
begin
  s:=angler_activity.target_key(s);
  if id is null or expected is null or expected<0 or num_nonnulls(w,m,s,k,n) not in (0,5) then
    raise exception 'Invalid contribution' using errcode='PT422';
  end if;
  if w is not null and (not exists(select from angler_discussions.waters where key=w)
      or not isfinite(m) or extract(day from m)<>1 or m<date '1900-01-01'
      or m>(statement_timestamp() at time zone 'Europe/Prague')::date or n not between 0 and 100000) then
    raise exception 'Invalid water, month or count' using errcode='PT422';
  end if;
  if w is not null and expected=0 then
    insert into angler_activity.trips(author,trip) values(actor,id) on conflict do nothing;
  end if;
  select * into r from angler_activity.trips where author=actor and trip=id for update;
  if not found then raise exception 'Contribution unavailable' using errcode='PT404'; end if;
  if row(r.water,r.month_start,r.target,r.method,r.fish) is not distinct from row(w,m,s,k,n)
     and r.revision in (expected, expected::bigint+1) then return angler_activity.receipt(r); end if;
  if expected<>r.revision then raise exception 'Contribution changed' using errcode='PT409'; end if;
  update angler_activity.trips set water=w,month_start=m,target=s,method=k,fish=n,revision=revision+1
    where author=actor and trip=id returning * into r;
  return angler_activity.receipt(r);
end
$$;

create function angler_activity.summary(w text,requested date,s text,k angler_activity.method)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare today date:=(statement_timestamp() at time zone 'Europe/Prague')::date;
  latest date:=(date_trunc('month',(today-7)::timestamp)-interval '1 month')::date;
  m date:=coalesce(requested,latest); sample jsonb;
begin
  perform angler_groups_private.subject();
  s:=angler_activity.target_key(s);
  if not exists(select from angler_discussions.waters where key=w) then raise exception 'Unknown water' using errcode='PT404'; end if;
  if not isfinite(m) or extract(day from m)<>1 or m>latest or m<date '1900-01-01' then
    raise exception 'Unavailable period' using errcode='PT422'; end if;
  with base as (select author,target,method,fish from angler_activity.trips where water=w and month_start=m),
    -- GROUPING bits: 0 = both dimensions, 1 = target, 2 = method, 3 = whole water.
    sizes as (select grouping(target,method) dimensions,count(*) trips,count(distinct author) filter(where angler_activity.reviewed_contributor(author)) anglers
      from base group by grouping sets ((target,method),(target),(method),())),
    safe as (select bool_and(trips>=10 and anglers>=5) filter(where dimensions=0) joint,
      bool_and(trips>=10 and anglers>=5) filter(where dimensions=1) species,
      bool_and(trips>=10 and anglers>=5) filter(where dimensions=2) methods,
      bool_and(trips>=10 and anglers>=5) filter(where dimensions=3) overall from sizes)
    select jsonb_build_object('trips',count(*),'anglers',count(distinct author),'fish',sum(fish),
      'successfulTrips',case when min(fish)=0 then count(*) filter(where fish>0) end)
      into sample from base cross join safe
      where overall and (s is null or target=s) and (k is null or method=k)
        and (s is null and k is null or joint or species and k is null or not species and methods and s is null)
      having count(*)>0;
  return jsonb_build_object('month',m,'latest',latest,'sample',sample);
end
$$;

create or replace function public.angler_activity_change(trip_id uuid,expected_revision int,water_key text default null,
  month_start date default null,target_species text default null,fishing_method text default null,fish_count int default null)
returns jsonb language sql security invoker set search_path='' as $$
  select angler_activity.change(trip_id,expected_revision,water_key,month_start,target_species,
    fishing_method::angler_activity.method,fish_count)
$$;
create or replace function public.angler_activity_summary(water_key text,month_start date default null,target_species text default null,
  fishing_method text default null) returns jsonb language sql stable security invoker set search_path='' as $$
  select angler_activity.summary(water_key,month_start,target_species,fishing_method::angler_activity.method)
$$;

drop function angler_activity.change(uuid,int,text,date,angler_activity.target,angler_activity.method,int);
drop function angler_activity.summary(text,date,angler_activity.target,angler_activity.method);
drop type angler_activity.target;

revoke all on function angler_activity.target_key(text),
  angler_activity.change(uuid,int,text,date,text,angler_activity.method,int),
  angler_activity.summary(text,date,text,angler_activity.method) from public,anon,authenticated;
grant execute on function angler_activity.change(uuid,int,text,date,text,angler_activity.method,int),
  angler_activity.summary(text,date,text,angler_activity.method) to authenticated;
