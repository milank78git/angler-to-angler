\ir ../supabase/migrations/20261123155308_private_messages.sql
select pg_temp.check_that(not has_table_privilege('authenticated','angler_messages.entries','select')
  and not has_table_privilege('authenticated','angler_messages.threads','update')
  and not has_function_privilege('anon','public.angler_message_inbox(bigint)','execute')
  and not has_function_privilege('authenticated','angler_messages.peer(uuid,uuid,uuid)','execute'),'Private message grants');
insert into auth.users values ('00000000-0000-4000-8000-000000000005',now());
set local role authenticated;
select pg_temp.as_user(5);
select public.angler_accept('Third angler','2026-11-23','2026-11-23');

do $$
declare q uuid:=gen_random_uuid(); q2 uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); tid uuid; first_entry bigint;
  receipt jsonb; page jsonb; cursor_pos bigint;
begin
  perform pg_temp.as_user(4);
  begin perform public.angler_message_inbox(); raise exception 'Unverified user'; exception when insufficient_privilege then null; end;
  perform pg_temp.as_user(2);
  perform public.angler_discussion_post('CZ:401001',null,q,'Where to fish?',null);
  perform public.angler_discussion_post('CZ:401009',null,q2,'Second water?',null);
  begin perform public.angler_message_history(null,q); raise exception 'Self contact'; exception when sqlstate 'PT404' then null; end;
  perform pg_temp.as_user(3);
  page:=public.angler_message_history(null,q);
  perform pg_temp.check_that(page->>'threadId' is null and page->>'canSend'='true' and page->>'questionText'='Where to fish?', 'Initial destination');
  begin perform public.angler_message_send(null,q,req,'  '); raise exception 'Empty message'; exception when invalid_parameter_value then null; end;
  receipt:=public.angler_message_send(null,q,req,'Only for you');
  tid:=(receipt->>'threadId')::uuid;
  perform pg_temp.check_that(receipt=public.angler_message_send(null,q,req,'Only for you'),'Retry receipt');
  begin perform public.angler_message_send(null,q,req,'Changed'); raise exception 'Changed retry'; exception when sqlstate 'PT409' then null; end;
  page:=public.angler_message_history(tid,null);
  first_entry:=(page->'items'->0->>'id')::bigint;
  perform pg_temp.check_that(jsonb_array_length(page->'items')=1 and page->'items'->0->>'mine'='true','Duplicate or bad ownership');
  begin perform public.angler_message_report(tid,first_entry); raise exception 'Sender reported own'; exception when sqlstate 'PT404' then null; end;
  perform pg_temp.as_user(5);
  perform pg_temp.check_that(public.angler_message_inbox()->'items'='[]'::jsonb,'Third inbox');
  begin perform public.angler_message_history(tid,null); raise exception 'Third read'; exception when sqlstate 'PT404' then null; end;
  begin perform public.angler_message_send(tid,null,req,'Other'); raise exception 'Third write'; exception when sqlstate 'PT404' then null; end;
  begin perform public.angler_message_block(tid,true); raise exception 'Third block'; exception when sqlstate 'PT404' then null; end;
  begin perform public.angler_message_report(tid,first_entry); raise exception 'Third report'; exception when sqlstate 'PT404' then null; end;
  perform pg_temp.as_user(2);
  perform pg_temp.check_that(public.angler_message_inbox()->'items'->0->>'threadId'=tid::text and
    public.angler_message_history(tid,null)->'items'->0->>'body'='Only for you' and
    public.angler_water_discussion('CZ:401001',q)->'items'='[]'::jsonb,'Private delivery or public leak');
  perform public.angler_message_report(tid,first_entry); perform public.angler_message_report(tid,first_entry);
  perform public.angler_message_send(tid,null,gen_random_uuid(),'Received.');
  perform public.angler_message_block(tid,true);
  perform pg_temp.as_user(3);
  perform pg_temp.check_that(public.angler_message_history(null,q2)->>'canSend'='false' and
    public.angler_message_history(tid,null)->'items'->1->>'reported'='false','Block scope or confidential report');
  begin perform public.angler_message_send(null,q2,gen_random_uuid(),'Another way'); raise exception 'Block bypass'; exception when sqlstate 'PT403' then null; end;
  perform pg_temp.check_that(public.angler_message_send(null,q,req,'Only for you')=receipt,'Lost receipt after block');
  perform public.angler_message_block(tid,true);
  perform pg_temp.as_user(2);
  perform public.angler_message_block(tid,false);
  begin perform public.angler_message_send(tid,null,gen_random_uuid(),'Still blocked'); raise exception 'Cleared peer block'; exception when sqlstate 'PT403' then null; end;
  perform public.angler_discussion_withdraw('CZ:401001',q);
  perform pg_temp.as_user(3);
  begin perform public.angler_message_send(null,q,gen_random_uuid(),'Withdrawn'); raise exception 'Contact via withdrawn question'; exception when sqlstate 'PT404' then null; end;
  perform public.angler_message_block(tid,false);
  perform pg_temp.check_that(public.angler_message_history(tid,null)->'items'->1->>'questionText' is null,'Withdrawn quotation');
  for n in 1..20 loop perform public.angler_message_send(tid,null,gen_random_uuid(),'Message '||n); end loop;
  page:=public.angler_message_history(tid,null);
  cursor_pos:=(page->>'next')::bigint;
  perform pg_temp.check_that(jsonb_array_length(page->'items')=20 and page->'items'->0->>'body'='Message 20','History page');
  perform public.angler_message_send(null,q2,gen_random_uuid(),'Another question, same conversation');
  page:=public.angler_message_history(tid,null,cursor_pos);
  perform pg_temp.check_that(jsonb_array_length(page->'items')=2 and page->'items'->1->>'body'='Only for you'
    and jsonb_array_length(public.angler_message_inbox()->'items')=1,'History cursor or duplicate conversation');
end$$;
reset role;
\ir message-reactions-db.sql
delete from auth.users where id='00000000-0000-4000-8000-000000000003';
select pg_temp.check_that(not exists(select from angler_messages.entries) and not exists(select from angler_messages.threads),
  'Account deletion retained conversations');
