-- One explicitly approved snapshot per account and local trip. Exact dates, locations and
-- free text never enter this schema. A withdrawn row keeps only its identity and revision.
create schema angler_activity;
revoke all on schema angler_activity from public, anon, authenticated;
grant usage on schema angler_activity to authenticated;
create type angler_activity.target as enum ('unspecified','pike','zander','barbel','roach','other');
create type angler_activity.method as enum ('unspecified','float','bottom','lure','fly','other');

create table angler_activity.trips (
  author uuid not null references angler_private.profiles(user_id) on delete cascade,
  trip uuid not null,
  position bigint generated always as identity unique,
  revision int not null default 0,
  water text references angler_discussions.waters(key),
  month_start date check (month_start >= date '1900-01-01' and extract(day from month_start)=1),
  target angler_activity.target, method angler_activity.method,
  fish int check (fish between 0 and 100000),
  primary key(author,trip),
  check (num_nonnulls(water,month_start,target,method,fish) in (0,5))
);
alter table angler_activity.trips enable row level security;
revoke all on angler_activity.trips from public, anon, authenticated;
create index activity_month on angler_activity.trips(water,month_start,target,method) where water is not null;
create index activity_by_owner on angler_activity.trips(author,position desc) where water is not null;

create function angler_activity.receipt(r angler_activity.trips) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object('revision',r.revision,'entry',case when r.water is not null then
    jsonb_build_object('trip',r.trip,'water',r.water,'month',r.month_start,'target',r.target,'method',r.method,'fish',r.fish)
    end)
$$;

create function angler_activity.state(id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject();
begin
  return coalesce((select angler_activity.receipt(r) from angler_activity.trips r
    where r.author=actor and r.trip=id),jsonb_build_object('revision',0,'entry',null));
end
$$;

-- Lock the owner's row before comparing revisions. A lost receipt can be replayed but an old
-- write can never revive a subsequently withdrawn contribution or replace a newer snapshot.
create function angler_activity.change(id uuid,expected int,w text,m date,s angler_activity.target,
  k angler_activity.method,n int) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); r angler_activity.trips;
begin
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

create function angler_activity.mine(cursor_pos bigint) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject();
begin
  return (with batch as (select r.position,angler_activity.receipt(r) item from angler_activity.trips r
    where r.author=actor and r.water is not null and (cursor_pos is null or r.position<cursor_pos)
    order by r.position desc limit 21), shown as (select * from batch order by position desc limit 20)
    select jsonb_build_object('items',coalesce(jsonb_agg(item order by position desc),'[]'::jsonb),
      'next',case when (select count(*) from batch)>20 then min(position)::text end) from shown);
end
$$;

-- Choose one safe partition for the entire water/month before applying user filters.
-- If a small cell would be exposed by subtracting published totals, fall back to a single
-- dimension or just the water total. Missing and suppressed results have the same response.
create function angler_activity.summary(w text,requested date,s angler_activity.target,k angler_activity.method)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare today date:=(statement_timestamp() at time zone 'Europe/Prague')::date;
  latest date:=(date_trunc('month',(today-7)::timestamp)-interval '1 month')::date;
  m date:=coalesce(requested,latest); sample jsonb;
begin
  perform angler_groups_private.subject();
  if not exists(select from angler_discussions.waters where key=w) then raise exception 'Unknown water' using errcode='PT404'; end if;
  if not isfinite(m) or extract(day from m)<>1 or m>latest or m<date '1900-01-01' then
    raise exception 'Unavailable period' using errcode='PT422'; end if;
  with base as (select author,target,method,fish from angler_activity.trips where water=w and month_start=m),
    -- GROUPING bits: 0 = both dimensions, 1 = target, 2 = method, 3 = whole water.
    sizes as (select grouping(target,method) dimensions,count(*) trips,count(distinct author) anglers
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

create function public.angler_activity_state(trip_id uuid) returns jsonb language sql stable security invoker
set search_path='' as $$select angler_activity.state(trip_id)$$;
create function public.angler_activity_change(trip_id uuid,expected_revision int,water_key text default null,
  month_start date default null,target_species text default null,fishing_method text default null,fish_count int default null)
returns jsonb language sql security invoker set search_path='' as $$
  select angler_activity.change(trip_id,expected_revision,water_key,month_start,target_species::angler_activity.target,
    fishing_method::angler_activity.method,fish_count)
$$;
create function public.angler_activity_mine(before_position bigint default null) returns jsonb language sql stable security invoker
set search_path='' as $$select angler_activity.mine(before_position)$$;
create function public.angler_activity_summary(water_key text,month_start date default null,target_species text default null,
  fishing_method text default null) returns jsonb language sql stable security invoker set search_path='' as $$
  select angler_activity.summary(water_key,month_start,target_species::angler_activity.target,fishing_method::angler_activity.method)
$$;
revoke all on all functions in schema angler_activity from public,anon,authenticated;
grant execute on function angler_activity.state(uuid),angler_activity.mine(bigint),
  angler_activity.change(uuid,int,text,date,angler_activity.target,angler_activity.method,int),
  angler_activity.summary(text,date,angler_activity.target,angler_activity.method) to authenticated;
revoke all on function public.angler_activity_state(uuid),public.angler_activity_mine(bigint),
  public.angler_activity_change(uuid,int,text,date,text,text,int),public.angler_activity_summary(text,date,text,text)
  from public,anon,authenticated;
grant execute on function public.angler_activity_state(uuid),public.angler_activity_mine(bigint),
  public.angler_activity_change(uuid,int,text,date,text,text,int),public.angler_activity_summary(text,date,text,text) to authenticated;
