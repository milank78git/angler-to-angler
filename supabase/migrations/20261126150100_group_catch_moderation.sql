-- Retain only the request identity on withdrawal so a delayed upload cannot restore a photo.
alter table angler_groups_private.catch_posts alter column caught drop not null, alter column species drop not null,
  add constraint catch_post_payload check ((caught is null)=(species is null) and
    (caught is not null or (length_mm is null and photo is null)));
create table angler_groups_private.catch_flags (
  post_position bigint primary key references angler_groups_private.catch_posts(position) on delete cascade,
  reported_at timestamptz not null default now()
);
alter table angler_groups_private.catch_flags enable row level security;
revoke all on angler_groups_private.catch_flags from public,anon,authenticated;
create trigger limit_catch_flags after insert on angler_groups_private.catch_flags
  for each row execute function angler_private.limit_write('reports','20');

create or replace function public.angler_group_catches(group_id uuid,before_position bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=angler_private.group_subject($1,'catch',false);
  owner boolean:=angler_groups_private.require_group_access($1,actor);
begin
  return (with batch as (select p.position,(owner or p.author=actor) as removable,(p.author<>actor) as reportable,p.caught,p.species,p.length_mm,p.photo,a.display_name
    from angler_groups_private.catch_posts p join angler_private.profiles a on a.user_id=p.author
    where p.group_id=$1 and p.caught is not null and ($2 is null or p.position<$2) order by p.position desc limit 3),
    page as (select * from batch order by position desc limit 2)
    select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('position',position::text,'canRemove',removable,'canReport',reportable,'author',display_name,'day',caught,
      'species',species,'mm',length_mm,'photo',replace(encode(photo,'base64'),chr(10),'')) order by position desc),'[]'::jsonb),
      'next',case when (select count(*) from batch)>2 then min(position)::text end) from page);
end $$;

-- Private operator entry point; reporters never gain access to another group's posts.
create function angler_groups_private.remove_shared_catch(post_position bigint) returns void
language plpgsql set search_path='' as $$
begin
  update angler_groups_private.catch_posts set caught=null,species=null,length_mm=null,photo=null where position=$1;
  delete from angler_groups_private.catch_flags f where f.post_position=$1;
end $$;
revoke all on function angler_groups_private.remove_shared_catch(bigint) from public,anon,authenticated;

create function public.angler_group_catch_report(group_id uuid, post_position bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_private.group_subject($1,'catch',false);
begin
  perform angler_groups_private.require_group_access($1,actor);
  perform from angler_groups_private.catch_posts p where p.group_id=$1 and p.position=$2 and p.caught is not null
    and p.author<>actor for share;
  if not found then raise exception 'Catch unavailable' using errcode='PT404'; end if;
  insert into angler_groups_private.catch_flags values($2,now()) on conflict do nothing;
  return '{}'::jsonb;
end $$;

create function public.angler_group_catch_remove(group_id uuid, post_position bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_private.verified_subject(); owner boolean:=angler_groups_private.require_group_access($1,actor);
begin
  perform from angler_groups_private.catch_posts p where p.group_id=$1 and p.position=$2 and (p.author=actor or owner) for update;
  if not found then raise exception 'Catch unavailable' using errcode='PT404'; end if;
  perform angler_groups_private.remove_shared_catch($2);
  return '{}'::jsonb;
end $$;
revoke all on function public.angler_group_catch_remove(uuid,bigint),public.angler_group_catch_report(uuid,bigint) from public,anon;
grant execute on function public.angler_group_catch_remove(uuid,bigint),public.angler_group_catch_report(uuid,bigint) to authenticated;
