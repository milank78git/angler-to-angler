-- One conversation per pair, even when the same anglers meet at different waters.
create schema angler_messages;
revoke all on schema angler_messages from public,anon,authenticated;
grant usage on schema angler_messages to authenticated;

create table angler_messages.threads (
  id uuid primary key default gen_random_uuid(),
  first_user uuid not null references angler_private.profiles(user_id) on delete cascade,
  second_user uuid not null references angler_private.profiles(user_id) on delete cascade,
  first_blocks boolean not null default false,
  second_blocks boolean not null default false,
  latest bigint,
  unique(first_user,second_user),
  check(first_user < second_user)
);
create index message_first_inbox on angler_messages.threads(first_user,latest desc);
create index message_second_inbox on angler_messages.threads(second_user,latest desc);

create table angler_messages.entries (
  position bigint generated always as identity primary key,
  thread uuid not null references angler_messages.threads(id) on delete cascade,
  from_first boolean not null,
  request_id uuid not null,
  body text not null check (char_length(body) between 1 and 1600 and body ~ '[^[:space:]]'),
  question uuid references angler_discussions.posts(id) on delete set null,
  posted_at timestamptz not null default clock_timestamp(),
  reported_at timestamptz,
  unique(thread,from_first,request_id)
);
create index message_history on angler_messages.entries(thread,position desc);
create index message_origin on angler_messages.entries(question) where question is not null;
alter table angler_messages.threads enable row level security;
alter table angler_messages.entries enable row level security;
revoke all on all tables in schema angler_messages from public,anon,authenticated;
revoke all on all sequences in schema angler_messages from public,anon,authenticated;

-- Initial contact is addressed through a visible question. A thread ID is useful only to its members.
create function angler_messages.peer(actor uuid, conversation uuid, topic uuid) returns uuid
language plpgsql stable set search_path='' as $$
declare other_user uuid;
begin
  if num_nonnulls(conversation,topic) <> 1 then
    raise exception 'Choose one destination' using errcode='22023';
  end if;
  if conversation is not null then
    select case when actor=t.first_user then t.second_user else t.first_user end into other_user
      from angler_messages.threads t where t.id=conversation and actor in (t.first_user,t.second_user);
  else
    select p.author_id into other_user from angler_discussions.posts p
      where p.id=topic and p.parent is null and p.body is not null and p.author_id<>actor;
  end if;
  if other_user is null then raise exception 'Destination unavailable' using errcode='PT404'; end if;
  return other_user;
end$$;

create function angler_messages.inbox(cursor_pos bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject();
begin
  return (with candidates as (
    select t.id,t.latest,a.display_name,e.posted_at
      from angler_messages.threads t join angler_messages.entries e on e.position=t.latest
      join angler_private.profiles a on a.user_id=case when t.first_user=actor then t.second_user else t.first_user end
      where actor in (t.first_user,t.second_user) and (cursor_pos is null or t.latest<cursor_pos)
      order by t.latest desc limit 21
  ), page as (select * from candidates order by latest desc limit 20)
  select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object('threadId',id,'peerName',display_name,
    'postedAt',posted_at) order by latest desc),'[]'::jsonb),
    'next',case when (select count(*) from candidates)>20 then min(latest)::text end) from page);
end$$;

create function angler_messages.history(conversation uuid,topic uuid,cursor_pos bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); other_user uuid:=angler_messages.peer(actor,conversation,topic);
  pair angler_messages.threads; page_data jsonb;
begin
  select t.* into pair from angler_messages.threads t where t.first_user=least(actor,other_user)
    and t.second_user=greatest(actor,other_user);
  with candidates as (
    select e.*,p.body as question_body from angler_messages.entries e
      left join angler_discussions.posts p on p.id=e.question
      where e.thread=pair.id and (cursor_pos is null or e.position<cursor_pos)
      order by e.position desc limit 21
  ), page as (select * from candidates order by position desc limit 20)
  select jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
    'id',position::text,'mine',from_first=(actor=pair.first_user),'body',body,'postedAt',posted_at,
    'questionText',question_body,'reported',reported_at is not null and from_first<>(actor=pair.first_user))
    order by position desc),'[]'::jsonb),
    'next',case when (select count(*) from candidates)>20 then min(position)::text end)
    into page_data from page;
  return page_data || jsonb_build_object('threadId',pair.id,
    'peerName',(select display_name from angler_private.profiles where user_id=other_user),
    'questionText',(select p.body from angler_discussions.posts p where p.id=topic),
    'blockedByMe',coalesce(case when actor=pair.first_user then pair.first_blocks else pair.second_blocks end,false),
    'canSend',not coalesce(pair.first_blocks or pair.second_blocks,false));
end$$;

create function angler_messages.send(conversation uuid,topic uuid,request uuid,content text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); other_user uuid:=angler_messages.peer(actor,conversation,topic);
  pair angler_messages.threads; prior angler_messages.entries; seq bigint; is_first boolean;
begin
  if request is null or content is null or char_length(content) not between 1 and 1600
      or content !~ '[^[:space:]]' then raise exception 'Invalid message' using errcode='22023'; end if;
  if topic is not null then
    -- Keep withdrawal and initial contact in a definite order.
    perform 1 from angler_discussions.posts where id=topic and body is not null for share;
    if not found then raise exception 'Destination unavailable' using errcode='PT404'; end if;
  end if;
  insert into angler_messages.threads(first_user,second_user) values(least(actor,other_user),greatest(actor,other_user))
    on conflict(first_user,second_user) do nothing;
  select t.* into strict pair from angler_messages.threads t where t.first_user=least(actor,other_user)
    and t.second_user=greatest(actor,other_user) for update;
  is_first:=actor=pair.first_user;
  select e.* into prior from angler_messages.entries e
    where e.thread=pair.id and e.from_first=is_first and e.request_id=request;
  if found then
    if prior.body<>content or prior.question is distinct from topic then
      raise exception 'Message request changed' using errcode='PT409';
    end if;
  else
    if pair.first_blocks or pair.second_blocks then raise exception 'Messaging paused' using errcode='PT403'; end if;
    insert into angler_messages.entries(thread,from_first,request_id,body,question)
      values(pair.id,is_first,request,content,topic) returning position into seq;
    update angler_messages.threads set latest=seq where id=pair.id;
  end if;
  return jsonb_build_object('threadId',pair.id,'requestId',request);
end$$;

create function angler_messages.set_block(conversation uuid,blocked boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject();
begin
  if blocked is null then raise exception 'Missing block decision' using errcode='22023'; end if;
  update angler_messages.threads set first_blocks=case when first_user=actor then blocked else first_blocks end,
    second_blocks=case when second_user=actor then blocked else second_blocks end
    where id=conversation and actor in (first_user,second_user);
  if not found then raise exception 'Conversation unavailable' using errcode='PT404'; end if;
  return '{}'::jsonb;
end$$;

-- Only a recipient can flag a received message. A report identifies precisely one entry.
create function angler_messages.report(conversation uuid,entry bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject();
begin
  update angler_messages.entries e set reported_at=coalesce(e.reported_at,clock_timestamp())
    from angler_messages.threads t where e.thread=t.id and t.id=conversation and e.position=entry
    and actor=case when e.from_first then t.second_user else t.first_user end;
  if not found then raise exception 'Message unavailable' using errcode='PT404'; end if;
  return '{}'::jsonb;
end$$;

create function public.angler_message_inbox(before_position bigint default null) returns jsonb
language sql stable security invoker set search_path='' as $$select angler_messages.inbox(before_position)$$;
create function public.angler_message_history(thread_id uuid,question_id uuid,before_position bigint default null) returns jsonb
language sql stable security invoker set search_path='' as $$select angler_messages.history(thread_id,question_id,before_position)$$;
create function public.angler_message_send(thread_id uuid,question_id uuid,request_id uuid,message text) returns jsonb
language sql security invoker set search_path='' as $$select angler_messages.send(thread_id,question_id,request_id,message)$$;
create function public.angler_message_block(thread_id uuid,blocked boolean) returns jsonb
language sql security invoker set search_path='' as $$select angler_messages.set_block(thread_id,blocked)$$;
create function public.angler_message_report(thread_id uuid,message_id bigint) returns jsonb
language sql security invoker set search_path='' as $$select angler_messages.report(thread_id,message_id)$$;

revoke all on all functions in schema angler_messages from public,anon,authenticated;
grant execute on function angler_messages.inbox(bigint),angler_messages.history(uuid,uuid,bigint),
  angler_messages.send(uuid,uuid,uuid,text),angler_messages.set_block(uuid,boolean),angler_messages.report(uuid,bigint)
  to authenticated;
revoke all on function public.angler_message_inbox(bigint),public.angler_message_history(uuid,uuid,bigint),
  public.angler_message_send(uuid,uuid,uuid,text),public.angler_message_block(uuid,boolean),public.angler_message_report(uuid,bigint)
  from public,anon,authenticated;
grant execute on function public.angler_message_inbox(bigint),public.angler_message_history(uuid,uuid,bigint),
  public.angler_message_send(uuid,uuid,uuid,text),public.angler_message_block(uuid,boolean),public.angler_message_report(uuid,bigint)
  to authenticated;
