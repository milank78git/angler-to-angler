-- Emoji bases are Unicode 17.0 Extended_Pictographic ranges. PostgreSQL's
-- default regex engine has no Unicode property escapes. Keep these bounds independent of locale.
create function angler_messages.single_emoji(glyph text) returns boolean
language plpgsql immutable strict set search_path='' as $$
declare
  bases constant text := '[' ||
    U&'\00A9\00AE\203C\2049\2122\2139\2194-\2199\21A9-\21AA\231A-\231B\2328\23CF\23E9-\23F3' ||
    U&'\23F8-\23FA\24C2\25AA-\25AB\25B6\25C0\25FB-\25FE\2600-\2604\260E\2611\2614-\2615\2618\261D' ||
    U&'\2620\2622-\2623\2626\262A\262E-\262F\2638-\263A\2640\2642\2648-\2653\265F-\2660\2663' ||
    U&'\2665-\2666\2668\267B\267E-\267F\2692-\2697\2699\269B-\269C\26A0-\26A1\26A7\26AA-\26AB' ||
    U&'\26B0-\26B1\26BD-\26BE\26C4-\26C5\26C8\26CE-\26CF\26D1\26D3-\26D4\26E9-\26EA\26F0-\26F5' ||
    U&'\26F7-\26FA\26FD\2702\2705\2708-\270D\270F\2712\2714\2716\271D\2721\2728\2733-\2734\2744' ||
    U&'\2747\274C\274E\2753-\2755\2757\2763-\2764\2795-\2797\27A1\27B0\27BF\2934-\2935\2B05-\2B07' ||
    U&'\2B1B-\2B1C\2B50\2B55\3030\303D\3297\3299\+01F004\+01F02C-\+01F02F\+01F094-\+01F09F' ||
    U&'\+01F0AF-\+01F0B0\+01F0C0\+01F0CF-\+01F0D0\+01F0F6-\+01F0FF\+01F170-\+01F171' ||
    U&'\+01F17E-\+01F17F\+01F18E\+01F191-\+01F19A\+01F1AE-\+01F1E5\+01F201-\+01F20F\+01F21A' ||
    U&'\+01F22F\+01F232-\+01F23A\+01F23C-\+01F23F\+01F249-\+01F25F\+01F266-\+01F321' ||
    U&'\+01F324-\+01F393\+01F396-\+01F397\+01F399-\+01F39B\+01F39E-\+01F3F0\+01F3F3-\+01F3F5' ||
    U&'\+01F3F7-\+01F3FA\+01F400-\+01F4FD\+01F4FF-\+01F53D\+01F549-\+01F54E\+01F550-\+01F567' ||
    U&'\+01F56F-\+01F570\+01F573-\+01F57A\+01F587\+01F58A-\+01F58D\+01F590\+01F595-\+01F596' ||
    U&'\+01F5A4-\+01F5A5\+01F5A8\+01F5B1-\+01F5B2\+01F5BC\+01F5C2-\+01F5C4\+01F5D1-\+01F5D3' ||
    U&'\+01F5DC-\+01F5DE\+01F5E1\+01F5E3\+01F5E8\+01F5EF\+01F5F3\+01F5FA-\+01F64F\+01F680-\+01F6C5' ||
    U&'\+01F6CB-\+01F6D2\+01F6D5-\+01F6E5\+01F6E9\+01F6EB-\+01F6F0\+01F6F3-\+01F6FF' ||
    U&'\+01F7DA-\+01F7FF\+01F80C-\+01F80F\+01F848-\+01F84F\+01F85A-\+01F85F\+01F888-\+01F88F' ||
    U&'\+01F8AE-\+01F8AF\+01F8BC-\+01F8BF\+01F8C2-\+01F8CF\+01F8D9-\+01F8FF\+01F90C-\+01F93A' ||
    U&'\+01F93C-\+01F945\+01F947-\+01F9FF\+01FA58-\+01FA5F\+01FA6E-\+01FAFF\+01FC00-\+01FFFD' || ']';
  element constant text := bases || U&'\FE0F?[\+01F3FB-\+01F3FF]?';
begin
  if char_length(glyph) not between 1 and 40 then return false; end if;
  -- Accept one pictograph, joined pictographs, flag, keycap or subdivision flag.
  return glyph collate "C" ~ ('^(' || element || '(' || chr(8205) || element || ')*|' ||
    U&'[\+01F1E6-\+01F1FF]{2}|[#*0-9]\FE0F?\20E3|\+01F3F4[\+0E0061-\+0E007A]{2,8}\+0E007F)$');
end$$;
revoke all on function angler_messages.single_emoji(text) from public,anon,authenticated;

-- Each participant owns one optional, replaceable reaction on each message.
alter table angler_messages.entries
  add column first_reaction text check (angler_messages.single_emoji(first_reaction)),
  add column second_reaction text check (angler_messages.single_emoji(second_reaction));

create function angler_messages.react(conversation uuid, entry bigint, glyph text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=angler_groups_private.subject(); pair angler_messages.threads;
  first_actor boolean; mine text; theirs text;
begin
  select * into pair from angler_messages.threads t
    where t.id=conversation and actor in (t.first_user,t.second_user) for update;
  if not found then raise exception 'Conversation unavailable' using errcode='PT404'; end if;
  first_actor:=actor=pair.first_user;
  select case when first_actor then e.first_reaction else e.second_reaction end,
         case when first_actor then e.second_reaction else e.first_reaction end into mine,theirs
    from angler_messages.entries e where e.thread=pair.id and e.position=entry;
  if not found then raise exception 'Message unavailable' using errcode='PT404'; end if;
  if glyph is not null and not angler_messages.single_emoji(glyph) then
    raise exception 'Choose one emoji' using errcode='22023';
  end if;
  if mine is distinct from glyph then
    if glyph is not null and (pair.first_blocks or pair.second_blocks) then
      raise exception 'Messaging paused' using errcode='PT403';
    end if;
    update angler_messages.entries set first_reaction=case when first_actor then glyph else first_reaction end,
      second_reaction=case when first_actor then second_reaction else glyph end where position=entry;
  end if;
  return jsonb_build_object('myReaction',glyph,'peerReaction',theirs);
end$$;

create or replace function angler_messages.history(conversation uuid,topic uuid,cursor_pos bigint) returns jsonb
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
    'myReaction',case when actor=pair.first_user then first_reaction else second_reaction end,
    'peerReaction',case when actor=pair.first_user then second_reaction else first_reaction end,
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

create function public.angler_message_react(thread_id uuid,message_id bigint,emoji text) returns jsonb
language sql security invoker set search_path='' as $$select angler_messages.react(thread_id,message_id,emoji)$$;
revoke all on function angler_messages.react(uuid,bigint,text), public.angler_message_react(uuid,bigint,text)
  from public,anon,authenticated;
grant execute on function angler_messages.react(uuid,bigint,text), public.angler_message_react(uuid,bigint,text)
  to authenticated;
