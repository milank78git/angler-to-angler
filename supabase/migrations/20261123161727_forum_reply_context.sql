-- Keep the question as the stable topic. An optional second link identifies the exact answer
-- being discussed, including when that answer itself was a follow-up.
alter table angler_discussions.posts
  add column reply_to uuid references angler_discussions.posts(id),
  add check (reply_to is null or (parent is not null and id<>reply_to)),
  alter column author_id drop not null,
  drop constraint posts_author_id_fkey,
  add foreign key (author_id) references angler_private.profiles(user_id) on delete set null;
create index forum_reply_target on angler_discussions.posts(reply_to) where reply_to is not null;

create function angler_discussions.has_replies(post uuid) returns boolean language sql stable set search_path='' as $$
  select exists(select from angler_discussions.posts where parent=post or reply_to=post)
$$;

-- Lock the question and addressed answer before accepting a reply. Withdrawal takes the same
-- row lock exclusively, so a racing reply either succeeds and protects its parent or is refused.
create function angler_discussions.write_post(target text,thread uuid,addressed uuid,request uuid,message text,outing date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); water_zone text;
begin
  select zone into water_zone from angler_discussions.waters where key=target;
  if not found then raise exception 'Unknown water' using errcode='PT404'; end if;
  if request is null or message is null or char_length(message) not between 1 and 1600 or message !~ '[^[:space:]]'
    or (thread is null and addressed is not null)
    or (outing is not null and (thread is null or not isfinite(outing) or outing<date '0001-01-01'
       or outing>(now() at time zone water_zone)::date)) then raise exception 'Invalid post' using errcode='22023'; end if;
  if thread is not null then
    perform from angler_discussions.posts where id=thread and water=target and parent is null and body is not null for share;
    if not found then raise exception 'Question unavailable' using errcode='PT404'; end if;
  end if;
  if addressed is not null then
    perform from angler_discussions.posts where id=addressed and water=target and parent=thread and body is not null for share;
    if not found then raise exception 'Reply unavailable' using errcode='PT404'; end if;
  end if;
  insert into angler_discussions.posts(id,water,parent,reply_to,author_id,body,trip_day)
    values(request,target,thread,addressed,actor,message,outing) on conflict(id) do nothing;
  if not found and not exists(select from angler_discussions.posts p where p.id=request and p.author_id=actor
    and p.water=target and p.parent is not distinct from thread and p.reply_to is not distinct from addressed
    and p.body=message and p.trip_day is not distinct from outing) then raise exception 'Request already used' using errcode='PT409'; end if;
  return jsonb_build_object('id',request);
end$$;
create or replace function angler_discussions.post(target text,thread uuid,request uuid,message text,outing date)
returns jsonb language sql security definer set search_path='' as $$select angler_discussions.write_post($1,$2,null,$3,$4,$5)$$;
create function public.angler_discussion_reply(water_key text,question_id uuid,reply_to_id uuid,request_id uuid,message text,trip_day date)
returns jsonb language sql security invoker set search_path='' as $$select angler_discussions.write_post($1,$2,$3,$4,$5,$6)$$;
revoke all on function angler_discussions.has_replies(uuid),angler_discussions.write_post(text,uuid,uuid,uuid,text,date),
  public.angler_discussion_reply(text,uuid,uuid,uuid,text,date) from public,anon,authenticated;
grant execute on function angler_discussions.write_post(text,uuid,uuid,uuid,text,date),
  public.angler_discussion_reply(text,uuid,uuid,uuid,text,date) to authenticated;

create or replace function angler_discussions.remove_content(target text,post uuid,owner_filter uuid) returns jsonb
language plpgsql set search_path='' as $$
begin
  perform from angler_discussions.posts p where p.id=post and p.water=target
    and (owner_filter is null or p.author_id=owner_filter) for update;
  if not found then raise exception 'Post unavailable' using errcode='PT404'; end if;
  if owner_filter is not null and angler_discussions.has_replies(post) then
    raise exception 'This post has replies' using errcode='PT409';
  end if;
  update angler_discussions.posts set body=null,trip_day=null,helpful=false where id=post;
  delete from angler_discussions.reports where post_id=post;
  return '{}'::jsonb;
end$$;

-- Erase the departing author's content and reports. The FK clears their identity without
-- cascading to another angler's posts. Redacted text is never copied into a quotation.
create function angler_discussions.erase_profile_posts() returns trigger language plpgsql security definer set search_path='' as $$
begin
  update angler_discussions.posts set body=null,trip_day=null,helpful=false where author_id=old.user_id;
  delete from angler_discussions.reports r using angler_discussions.posts p
    where p.id=r.post_id and p.author_id=old.user_id;
  return old;
end$$;
revoke all on function angler_discussions.erase_profile_posts() from public,anon,authenticated;
create trigger erase_forum_text before delete on angler_private.profiles for each row execute function angler_discussions.erase_profile_posts();

create or replace function angler_discussions.card(p angler_discussions.posts,nickname text,actor uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',p.id,'author',case when p.body is not null then nickname end,
    'mine',coalesce(p.author_id=actor and p.body is not null,false),'body',p.body,'removed',p.body is null,'postedAt',p.posted_at,
    'tripDay',p.trip_day,'helpful',p.helpful,'canWithdraw',case when p.author_id=actor and p.body is not null
      then not angler_discussions.has_replies(p.id) else false end,
    'replyTo',(select jsonb_build_object('id',r.id,'author',case when r.body is not null then a.display_name end,
      'excerpt',left(r.body,160)) from angler_discussions.posts r left join angler_private.profiles a on a.user_id=r.author_id
      where r.id=p.reply_to),
    'reported',exists(select from angler_discussions.reports r where r.post_id=p.id and r.reporter=actor))
$$;

create or replace function angler_discussions.page(target text, thread uuid, cursor_pos bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); question jsonb;
begin
  if not exists(select from angler_discussions.waters w where w.key=target) then
    raise exception 'Unknown water' using errcode='PT404';
  end if;
  if thread is not null then
    select angler_discussions.card(p,a.display_name,actor) into question
      from angler_discussions.posts p left join angler_private.profiles a on p.author_id=a.user_id
      where p.id=thread and p.water=target and p.parent is null and (p.body is not null or exists(select from angler_discussions.posts r where r.parent=p.id and r.body is not null));
    if not found then raise exception 'Question unavailable' using errcode='PT404'; end if;
  end if;
  return (
    with batch as (
      select p.position, angler_discussions.card(p,a.display_name,actor) ||
        case when thread is null then jsonb_build_object('replyCount',(select count(*)
          from angler_discussions.posts r where r.parent=p.id and r.body is not null)) else '{}'::jsonb end as item
      from angler_discussions.posts p left join angler_private.profiles a on p.author_id=a.user_id
      where p.water=target and ((thread is null and p.parent is null) or p.parent=thread)
        and (p.body is not null or (p.parent is null and exists(select from angler_discussions.posts r where r.parent=p.id and r.body is not null)))
        and (cursor_pos is null or p.position<cursor_pos)
      order by p.position desc limit 21
    ), shown as (select * from batch order by position desc limit 20)
    select jsonb_build_object('question',question,'items',coalesce(jsonb_agg(item order by position desc),'[]'::jsonb),
      'next',case when (select count(*) from batch)>20 then min(position)::text end) from shown
  );
end;
$$;
