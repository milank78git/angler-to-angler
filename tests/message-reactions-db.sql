\ir ../supabase/migrations/20261123160129_message_reactions.sql
select pg_temp.check_that(not has_function_privilege('anon','public.angler_message_react(uuid,bigint,text)','execute'), 'Reaction grants');
set local role authenticated;
do $$
declare q uuid:=gen_random_uuid(); tid uuid; entry bigint; item jsonb; glyph text;
begin
  perform pg_temp.as_user(2);
  perform public.angler_discussion_post('CZ:401009',null,q,'Who caught a fish? 🎣',null);
  perform pg_temp.as_user(3);
  tid:=(public.angler_message_send(null,q,gen_random_uuid(),'Yes 🐟 👨‍👩‍👧 👍🏽')->>'threadId')::uuid;
  item:=public.angler_message_history(tid,null)->'items'->0;
  entry:=(item->>'id')::bigint;
  perform pg_temp.check_that(item->>'body'='Yes 🐟 👨‍👩‍👧 👍🏽' and item->>'myReaction' is null, 'Inline emoji or migration default');
  foreach glyph in array array['👍', '👍🏽','❤️','👨‍👩‍👧','👩🏽‍💻','🇨🇿','1️⃣'] loop
    perform public.angler_message_react(tid,entry,glyph);
    perform pg_temp.check_that(public.angler_message_react(tid,entry,glyph)->>'myReaction'=glyph,'Retry changed reaction');
  end loop;
  foreach glyph in array array['A', 'OK', '', '🐟🐟', '👍text', '<b>','🇨','1','🐟'||chr(10)] loop
    begin perform public.angler_message_react(tid,entry,glyph); raise exception 'Invalid reaction accepted'; exception when invalid_parameter_value then null; end;
  end loop;
  perform pg_temp.as_user(2);
  item:=public.angler_message_react(tid,entry,'🎣');
  perform pg_temp.check_that(item->>'myReaction'='🎣' and item->>'peerReaction'='1️⃣','Overwrote peer');
  perform public.angler_message_block(tid,true);
  perform pg_temp.as_user(3);
  begin perform public.angler_message_react(tid,entry,'😂'); raise exception 'Reacted after block'; exception when sqlstate 'PT403' then null; end;
  perform public.angler_message_react(tid,entry,null);
  item:=public.angler_message_history(tid,null)->'items'->0;
  perform pg_temp.check_that(item->>'myReaction' is null and item->>'peerReaction'='🎣','Withdrawal while blocked');
  perform pg_temp.as_user(5);
  begin perform public.angler_message_react(tid,entry,'🐟'); raise exception 'Third-party reaction'; exception when sqlstate 'PT404' then null; end;
  perform pg_temp.as_user(2);
  perform public.angler_message_block(tid,false);
  perform pg_temp.as_user(5);
  tid:=(public.angler_message_send(null,q,gen_random_uuid(),'Separate conversation')->>'threadId')::uuid;
  begin perform public.angler_message_react(tid,entry,'🐟'); raise exception 'Cross-thread reaction'; exception when sqlstate 'PT404' then null; end;
end$$;
reset role;
delete from auth.users where id='00000000-0000-4000-8000-000000000005';
