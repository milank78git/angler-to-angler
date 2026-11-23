-- The Data API exposes only the public RPC wrappers. The tables have no client grants.
create schema angler_groups_private;
revoke all on schema angler_groups_private from public, anon, authenticated;
grant usage on schema angler_groups_private to authenticated;

create table angler_groups_private.groups (
  id uuid primary key,
  owner_id uuid not null references angler_private.profiles(user_id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60 and name = btrim(name)),
  invite_hash bytea unique,
  invite_expires_at timestamptz,
  check ((invite_hash is null) = (invite_expires_at is null))
);
create index groups_by_owner on angler_groups_private.groups(owner_id);
create table angler_groups_private.members (
  group_id uuid not null references angler_groups_private.groups(id) on delete cascade,
  user_id uuid not null references angler_private.profiles(user_id) on delete cascade,
  joined_with bytea not null,
  primary key (group_id, user_id)
);
create index members_by_user on angler_groups_private.members(user_id);
alter table angler_groups_private.groups enable row level security;
alter table angler_groups_private.members enable row level security;
revoke all on all tables in schema angler_groups_private from public, anon, authenticated;

-- An offline journal lease, anonymous JWT or unconfirmed identity cannot manage groups.
create function angler_groups_private.subject() returns uuid
language plpgsql stable set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if (public.angler_profile()->>'current')::boolean is not true or not exists (
    select from auth.users where id = actor and email_confirmed_at is not null
  ) then raise exception 'Verified profile required' using errcode='42501'; end if;
  return actor;
end;
$$;

create function angler_groups_private.list_groups() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare actor uuid := angler_groups_private.subject();
begin
  return jsonb_build_object('groups', coalesce((
    select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'owner',g.owner_id=actor,
                         'memberCount',1+(select count(*) from angler_groups_private.members c where c.group_id=g.id))
                     order by g.name,g.id)
    from angler_groups_private.groups g
    where g.owner_id=actor or exists (select from angler_groups_private.members m
                                      where m.group_id=g.id and m.user_id=actor)
  ), '[]'::jsonb));
end;
$$;

-- The client retains the requested UUID across retries of the same create operation.
create function angler_groups_private.create_group(group_id uuid, group_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := angler_groups_private.subject();
begin
  insert into angler_groups_private.groups(id,owner_id,name) values(group_id,actor,btrim(group_name))
    on conflict(id) do nothing;
  if not exists (select from angler_groups_private.groups g
                 where g.id=group_id and g.owner_id=actor and g.name=btrim(group_name)) then
    raise exception 'Cannot create group' using errcode='22023';
  end if;
  return jsonb_build_object('id',group_id);
end;
$$;

-- Replacing the hash immediately revokes the previous invitation. Only the issuing response carries the code.
create function angler_groups_private.invite(group_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := angler_groups_private.subject(); code uuid := gen_random_uuid();
        expiry timestamptz := clock_timestamp() + interval '24 hours';
begin
  update angler_groups_private.groups g set invite_hash=sha256(uuid_send(code)), invite_expires_at=expiry
    where g.id=group_id and g.owner_id=actor;
  if not found then raise exception 'Group unavailable' using errcode='42501'; end if;
  return jsonb_build_object('code',code,'expiresAt',expiry);
end;
$$;

-- Lock the invitation's group before claiming it. A retry by its original member is idempotent.
create function angler_groups_private.join_group(invite_code uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := angler_groups_private.subject(); fingerprint bytea := sha256(uuid_send(invite_code));
        target angler_groups_private.groups;
begin
  select * into target from angler_groups_private.groups g where g.invite_hash=fingerprint for update;
  if not found or target.invite_expires_at <= clock_timestamp() then
    if exists (select from angler_groups_private.members m where m.user_id=actor and m.joined_with=fingerprint) then
      return '{}'::jsonb;
    end if;
    raise exception 'Invitation unavailable' using errcode='22023';
  end if;
  if target.owner_id <> actor then
    insert into angler_groups_private.members(group_id,user_id,joined_with) values(target.id,actor,fingerprint)
      on conflict do nothing;
    if found then
      update angler_groups_private.groups set invite_hash=null, invite_expires_at=null where id=target.id;
    end if;
  end if;
  return '{}'::jsonb;
end;
$$;

-- Leaving only deletes the caller's membership. Dissolving requires a separate owner action.
create function angler_groups_private.leave_group(group_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := angler_groups_private.subject();
begin
  delete from angler_groups_private.members m where m.group_id=$1 and m.user_id=actor;
  return '{}'::jsonb;
end;
$$;
create function angler_groups_private.dissolve(group_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := angler_groups_private.subject();
begin
  delete from angler_groups_private.groups g where g.id=group_id and g.owner_id=actor;
  return '{}'::jsonb;
end;
$$;

create function public.angler_groups() returns jsonb language sql stable security invoker set search_path = ''
  as $$select angler_groups_private.list_groups()$$;
create function public.angler_group_create(group_id uuid, group_name text) returns jsonb language sql security invoker set search_path = ''
  as $$select angler_groups_private.create_group($1,$2)$$;
create function public.angler_group_invite(group_id uuid) returns jsonb language sql security invoker set search_path = ''
  as $$select angler_groups_private.invite($1)$$;
create function public.angler_group_join(invite_code uuid) returns jsonb language sql security invoker set search_path = ''
  as $$select angler_groups_private.join_group($1)$$;
create function public.angler_group_leave(group_id uuid) returns jsonb language sql security invoker set search_path = ''
  as $$select angler_groups_private.leave_group($1)$$;
create function public.angler_group_dissolve(group_id uuid) returns jsonb language sql security invoker set search_path = ''
  as $$select angler_groups_private.dissolve($1)$$;

revoke all on all functions in schema angler_groups_private from public, anon, authenticated;
grant execute on function angler_groups_private.list_groups(), angler_groups_private.create_group(uuid,text),
  angler_groups_private.invite(uuid), angler_groups_private.join_group(uuid),
  angler_groups_private.leave_group(uuid), angler_groups_private.dissolve(uuid) to authenticated;
revoke all on function public.angler_groups(), public.angler_group_create(uuid,text), public.angler_group_invite(uuid),
  public.angler_group_join(uuid), public.angler_group_leave(uuid), public.angler_group_dissolve(uuid) from public, anon;
grant execute on function public.angler_groups(), public.angler_group_create(uuid,text), public.angler_group_invite(uuid),
  public.angler_group_join(uuid), public.angler_group_leave(uuid), public.angler_group_dissolve(uuid) to authenticated;
