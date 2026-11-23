-- Only the reviewed text is stored. A member's optional composite FK ties their
-- posts to this particular membership, including when a concurrent leave wins.
create table angler_groups_private.tips (
  position bigint generated always as identity primary key,
  group_id uuid not null references angler_groups_private.groups(id) on delete cascade,
  author_id uuid not null references angler_private.profiles(user_id) on delete cascade,
  member_id uuid check (member_id = author_id),
  foreign key (group_id, member_id) references angler_groups_private.members(group_id, user_id) on delete cascade,
  request_id uuid not null,
  body text not null check (char_length(body) between 1 and 4096 and body ~ '[^[:space:]]'),
  posted_at timestamptz not null default clock_timestamp(),
  unique (author_id, request_id)
);
create index tips_by_group_position on angler_groups_private.tips(group_id, position desc);
create index tips_by_membership on angler_groups_private.tips(group_id, member_id);
alter table angler_groups_private.tips enable row level security;
revoke all on angler_groups_private.tips from public, anon, authenticated;

-- Both readers and writers must still belong to the requested group. An owner
-- is represented on the group itself, without a separate membership row.
create function angler_groups_private.require_group_access(target uuid, actor uuid) returns boolean
language plpgsql stable set search_path = '' as $$
declare is_owner boolean;
begin
  select g.owner_id = actor into is_owner from angler_groups_private.groups g
  where g.id = target and (g.owner_id = actor or exists (
    select from angler_groups_private.members m where m.group_id = g.id and m.user_id = actor));
  if not found then raise exception 'Group unavailable' using errcode='42501'; end if;
  return is_owner;
end;
$$;

create function angler_groups_private.post_tip(target uuid, request uuid, message text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := angler_groups_private.subject();
        is_owner boolean := angler_groups_private.require_group_access(target, actor);
begin
  if request is null or message is null or char_length(message) not between 1 and 4096
    or message !~ '[^[:space:]]' then
    raise exception 'Invalid tip' using errcode='22023';
  end if;
  insert into angler_groups_private.tips(group_id, author_id, member_id, request_id, body)
    values(target, actor, case when not is_owner then actor end, request, message)
    on conflict (author_id, request_id) do nothing;
  if not found and not exists (
    select from angler_groups_private.tips t where t.author_id=actor and t.request_id=request
      and t.group_id=target and t.body=message
  ) then raise exception 'Request already used' using errcode='PT409'; end if;
  return jsonb_build_object('id',request);
exception when foreign_key_violation then
  raise exception 'Group unavailable' using errcode='42501';
end;
$$;

-- A strict cursor skips newer arrivals and does not need the previous row to survive.
create function angler_groups_private.list_tips(target uuid, older_than bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform angler_groups_private.require_group_access(target, angler_groups_private.subject());
  return (
    with batch as (
      select t.position, t.body, t.posted_at, p.display_name
      from angler_groups_private.tips t join angler_private.profiles p on p.user_id=t.author_id
      where t.group_id=target and (older_than is null or t.position < older_than)
      order by t.position desc limit 21
    ), page as (select * from batch order by position desc limit 20)
    select jsonb_build_object('tips', coalesce(jsonb_agg(jsonb_build_object(
      'author',display_name,'text',body,'postedAt',floor(extract(epoch from posted_at)*1000)::bigint
    ) order by position desc), '[]'::jsonb),
      'next', case when (select count(*) from batch)>20 then min(position)::text end)
    from page
  );
end;
$$;

create function public.angler_group_tip_post(group_id uuid, request_id uuid, message text)
returns jsonb language sql security invoker set search_path = ''
as $$select angler_groups_private.post_tip($1,$2,$3)$$;
create function public.angler_group_tips(group_id uuid, before_position bigint default null)
returns jsonb language sql stable security invoker set search_path = ''
as $$select angler_groups_private.list_tips($1,$2)$$;
revoke all on function angler_groups_private.require_group_access(uuid,uuid),
  angler_groups_private.post_tip(uuid,uuid,text), angler_groups_private.list_tips(uuid,bigint),
  public.angler_group_tip_post(uuid,uuid,text), public.angler_group_tips(uuid,bigint) from public,anon,authenticated;
grant execute on function angler_groups_private.post_tip(uuid,uuid,text), angler_groups_private.list_tips(uuid,bigint),
  public.angler_group_tip_post(uuid,uuid,text), public.angler_group_tips(uuid,bigint) to authenticated;
