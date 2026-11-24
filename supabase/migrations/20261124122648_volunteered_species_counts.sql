-- Actual catalogue catches are a separate, explicitly previewed contribution.
alter table angler_activity.trips add column species_counts jsonb, add column species_revision bigint not null default 0;
create function angler_activity.clear_species() returns trigger language plpgsql set search_path='' as $$
begin
  new.species_counts:=null;
  new.species_revision:=old.species_revision+1;
  return new;
end $$;
create trigger clear_species_on_trip_change before update of revision on angler_activity.trips
for each row when (old.revision is distinct from new.revision) execute function angler_activity.clear_species();
revoke all on function angler_activity.clear_species() from public, anon, authenticated;

create function angler_activity.species_share(id uuid, trip_revision int, expected bigint, counts jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); r angler_activity.trips; total bigint;
begin
  select * into r from angler_activity.trips where author=actor and trip=id for update;
  if not found or r.water is null then raise exception 'Shared trip missing' using errcode='PT404'; end if;
  if expected is not null then
    if trip_revision is distinct from r.revision then raise exception 'Trip changed' using errcode='PT409'; end if;
    if counts is not null then
      if jsonb_typeof(counts)<>'object' or counts='{}' or pg_column_size(counts)>100000 then
        raise exception 'Invalid species counts' using errcode='PT422'; end if;
      if exists(select from jsonb_each(counts) f left join angler_market.species s on s.latin=f.key
        where s.latin is null or jsonb_typeof(f.value)<>'number' or f.value::text !~ '^[1-9][0-9]{0,5}$') then
        raise exception 'Unknown fish or invalid count' using errcode='PT422'; end if;
      select sum(value::int) into total from jsonb_each_text(counts);
      if total>r.fish then raise exception 'Species total exceeds shared fish' using errcode='PT422'; end if;
    end if;
    if counts is distinct from r.species_counts then
      if expected<>r.species_revision then raise exception 'Counts changed' using errcode='PT409'; end if;
      update angler_activity.trips set species_counts=counts,species_revision=species_revision+1
        where author=actor and trip=id returning * into r;
    end if;
  end if;
  return jsonb_build_object('counts',r.species_counts,'version',r.species_revision);
end $$;
create function public.angler_trip_species(trip_id uuid,trip_revision integer default null,expected_version bigint default null,counts jsonb default null)
returns jsonb language sql set search_path='' as $$select angler_activity.species_share(trip_id,trip_revision,expected_version,counts)$$;

create function angler_activity.top_species() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare period date:=(date_trunc('month',(timezone('Europe/Prague',now())::date-7)::timestamp)-interval '1 month')::date;
begin
  perform angler_groups_private.subject();
  return jsonb_build_object('month',period,'species',(select coalesce(jsonb_agg(to_jsonb(r) order by r.fish desc,r.latin),'[]')
    from (select f.key latin,sum(f.value::integer) fish from angler_activity.trips t cross join lateral jsonb_each_text(t.species_counts) f
      where t.water is not null and t.month_start=period group by f.key having count(*)>=10 and count(distinct author)>=5
      order by fish desc,latin limit 10) r));
end $$;
create function public.angler_top_species() returns jsonb language sql stable set search_path='' as $$select angler_activity.top_species()$$;
revoke all on function angler_activity.species_share(uuid,int,bigint,jsonb),public.angler_trip_species(uuid,int,bigint,jsonb),
  angler_activity.top_species(),public.angler_top_species() from public,anon;
grant execute on function angler_activity.species_share(uuid,int,bigint,jsonb),public.angler_trip_species(uuid,int,bigint,jsonb),
  angler_activity.top_species(),public.angler_top_species() to authenticated;
