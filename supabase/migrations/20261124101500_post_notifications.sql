-- A device can check for new community posts while the account vault is locked.
-- Its random capability cannot read messages, post bodies, author identities or journal data.
create table angler_discussions.post_watches (
  digest bytea primary key,
  owner_id uuid not null references angler_private.profiles(user_id) on delete cascade,
  expires_at timestamptz not null
);
alter table angler_discussions.post_watches enable row level security;

create function public.angler_post_signal(device_key uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid; signal jsonb;
begin
  select owner_id into actor from angler_discussions.post_watches
    where digest=sha256(convert_to(device_key::text,'UTF8')) and expires_at>now();
  if actor is null then raise exception 'Subscription unavailable' using errcode='PT403'; end if;
  select jsonb_build_object('position',position::text,'water',water) into signal
    from angler_discussions.posts where author_id<>actor and body is not null
    order by position desc limit 1;
  return coalesce(signal,'{"position":"0"}'::jsonb);
end $$;

create function public.angler_register_post_watch(device_key uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare actor uuid:=angler_groups_private.subject();
begin
  if device_key is null then raise exception 'Device key required' using errcode='PT422'; end if;
  delete from angler_discussions.post_watches where expires_at<=now();
  insert into angler_discussions.post_watches values
    (sha256(convert_to(device_key::text,'UTF8')),actor,now()+interval '30 days')
  on conflict (digest) do update set expires_at=excluded.expires_at
    where angler_discussions.post_watches.owner_id=actor;
  if not found then raise exception 'Subscription unavailable' using errcode='PT403'; end if;
  return public.angler_post_signal(device_key);
end $$;
revoke all on function public.angler_register_post_watch(uuid),public.angler_post_signal(uuid) from public;
grant execute on function public.angler_register_post_watch(uuid) to authenticated;
grant execute on function public.angler_post_signal(uuid) to anon,authenticated;


create function public.angler_end_post_watch(device_key uuid) returns jsonb
language sql volatile security definer set search_path = '' as $$
  delete from angler_discussions.post_watches where digest=sha256(convert_to(device_key::text,'UTF8'));
  select '{}'::jsonb;
$$;
revoke all on function public.angler_end_post_watch(uuid) from public;
grant execute on function public.angler_end_post_watch(uuid) to anon,authenticated;
