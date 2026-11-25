\ir ../supabase/migrations/20261123180057_public_catch_cards.sql
\ir ../supabase/migrations/20261125154159_public_card_reader.sql
insert into auth.users select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now()
  from generate_series(61,62) n;
select pg_temp.check_that(not has_table_privilege('anon','angler_public_cards.cards','select')
  and not has_table_privilege('authenticated','angler_public_cards.cards','insert')
  and not has_function_privilege('anon','public.angler_public_cards(bigint)','execute')
  and not has_function_privilege('anon','angler_public_cards.publish(uuid,uuid,jsonb,text,text)','execute')
  and has_function_privilege('anon','public.angler_open_catch_card(uuid)','execute'),'Public card grants');
set local role authenticated;
select pg_temp.as_user(61); select public.angler_accept('River','2026-11-23','2026-11-23');
select pg_temp.as_user(62); select public.angler_accept('Lake','2026-11-23','2026-11-23');
reset role;
select set_config('test.public_source',gen_random_uuid()::text,true);
insert into angler_private.catch_evidence(user_id,catch_id,species,captured_at,water,fingerprint,lat100,lon100,outcome,length_mm)
  values ('00000000-0000-4000-8000-000000000061',current_setting('test.public_source')::uuid,'Perch',now(),
    'Unpublished landmark',decode('aabbcc','hex'),5012,1465,'estimated',270);
set local role authenticated;
select pg_temp.as_user(61);
do $$
declare source uuid:=current_setting('test.public_source')::uuid; req uuid:=gen_random_uuid(); receipt jsonb; link uuid;
  draft jsonb:='{"name":"River","species":"Perch","date":"2025-08","precision":"month"}'; opts jsonb;
  photo text:='UklGRjwAAABXRUJQVlA4IDAAAAAwAgCdASoEAAMAAQAeJaACdLoB+AH4AARoAAD+3UR/909IQNH/MH/9tDOqEv9oAAA=';
begin
  opts:=public.angler_public_card_options(source,'CZ:401009');
  perform pg_temp.check_that(opts->'proof'->>'kind'='estimated' and opts->'active'='null'::jsonb,'Owner options');
  begin perform public.angler_public_card_publish(source,req,draft||'{"gps":"secret"}');raise exception 'Extra fields';
    exception when sqlstate 'PT409' then null;end;
  begin perform public.angler_public_card_publish(source,req,draft||'{"date":"2025-08-17"}');raise exception 'Exact day for month card';
    exception when sqlstate 'PT422' then null;end;
  begin perform public.angler_public_card_publish(source,req,draft||'{"length":{"mm":270,"kind":"measured"}}');
    raise exception 'False measurement';exception when sqlstate 'PT409' then null;end;
  begin perform public.angler_public_card_publish(source,req,draft,null,encode(decode(photo,'base64')||decode('65786966','hex'),'base64'));
    raise exception 'Photo trailer';exception when sqlstate 'PT422' then null;end;
  receipt:=public.angler_public_card_publish(source,req,draft);
  link:=(receipt->>'id')::uuid;
  perform pg_temp.check_that(receipt->>'url'='https://milank78git.github.io/angler-to-angler/catch-card/#'||link,'Wrong viewer URL');
  perform pg_temp.check_that(link<>source and link<>req and public.angler_open_catch_card(link)=draft
    and public.angler_public_card_publish(source,req,draft)=receipt,'Projection or retry');
  begin perform public.angler_public_card_publish(source,gen_random_uuid(),draft);
    raise exception 'Duplicate active card'; exception when sqlstate 'PT409' then null; end;
  perform pg_temp.as_user(62);
  perform pg_temp.check_that(public.angler_public_cards()->'items'='[]'::jsonb
    and public.angler_public_card_options(source)->'proof'='null'::jsonb,'Other author visible');
  begin perform public.angler_public_card_withdraw(link);raise exception 'Foreign withdrawal';exception when sqlstate 'PT404' then null;end;
  perform pg_temp.as_user(61);
  perform public.angler_public_card_withdraw(link);perform public.angler_public_card_withdraw(link);
  perform pg_temp.check_that(public.angler_open_catch_card(link) is null,'Withdrawn copy visible');
  begin perform public.angler_public_card_publish(source,req,draft);raise exception 'Replayed withdrawn card';exception when sqlstate 'PT409' then null;end;
  draft:=draft||jsonb_build_object('date','2025-08-17','precision','day','water',opts->>'water',
    'length',jsonb_build_object('kind','estimated','mm',270));
  receipt:=public.angler_public_card_publish(source,gen_random_uuid(),draft,'CZ:401009',photo);
  perform pg_temp.check_that(receipt->>'id'<>link::text and public.angler_open_catch_card((receipt->>'id')::uuid)=
    draft||jsonb_build_object('photo',photo),'New link or reviewed snapshot');
  perform set_config('test.public_link',receipt->>'id',true);
end $$;
reset role;
set local role anon;
select pg_temp.check_that(public.angler_open_catch_card(current_setting('test.public_link')::uuid)->>'species'='Perch'
  and public.angler_open_catch_card(gen_random_uuid()) is null,'Anonymous link read');
reset role;
delete from auth.users where id='00000000-0000-4000-8000-000000000061';
select pg_temp.check_that(public.angler_open_catch_card(current_setting('test.public_link')::uuid) is null,'Erased account visible');
