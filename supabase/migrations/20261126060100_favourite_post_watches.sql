-- Old installations retain their capability but cannot receive unrelated public activity.
alter table angler_discussions.post_watches add column water_keys text[] not null default '{}';
create index watched_water_posts on angler_discussions.posts(water,position desc) where body is not null;
create or replace function public.angler_post_signal(device_key uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid; favourites text[]; signal jsonb;
begin
  select owner_id,water_keys into actor,favourites from angler_discussions.post_watches
    where digest=sha256(convert_to(device_key::text,'UTF8')) and expires_at>now();
  if actor is null then raise exception 'Subscription unavailable' using errcode='PT403'; end if;
  select jsonb_build_object('position',position::text,'water',water) into signal
    from angler_discussions.posts where water=any(favourites) and author_id<>actor and body is not null
    order by position desc limit 1;
  return coalesce(signal,'{"position":"0"}'::jsonb);
end $$;


create function public.angler_watch_favourites(device_key uuid, water_keys text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := angler_groups_private.subject();
begin
  if cardinality(water_keys)>4096 or water_keys is null then raise exception 'Invalid favourites' using errcode='PT422'; end if;
  perform public.angler_register_post_watch(device_key);
  update angler_discussions.post_watches w set water_keys=array(
    select k.key from angler_discussions.waters k where k.key=any($2) order by k.key)
    where w.owner_id=actor and w.digest=sha256(convert_to(device_key::text,'UTF8'));
  return public.angler_post_signal(device_key);
end $$;
revoke all on function public.angler_watch_favourites(uuid,text[]) from public,anon;
grant execute on function public.angler_watch_favourites(uuid,text[]) to authenticated;
