\ir ../supabase/migrations/20261125075258_private_journal_sync.sql
\ir ../supabase/migrations/20261125175001_journal_operations.sql
select pg_temp.check_that(not has_function_privilege('authenticated','angler_sync.save_document(uuid,jsonb)','execute')
  and not has_function_privilege('anon','angler_sync.save_document(uuid,jsonb)','execute'),'Internal operation must be private');
set local role authenticated;
select pg_temp.as_user(71);
do $$declare h text:=encode(sha256('journal'::bytea),'hex'); args jsonb; begin
 perform pg_temp.check_that(public.angler_journal_sync('settings','{}')->>'enabled'='false','Unexpected sync setting');
 perform public.angler_journal_sync('enable','{}');
 perform pg_temp.check_that(public.angler_journal_sync('settings','{}')->>'enabled'='true','Account setting not persisted');
 perform public.angler_journal_sync('put',jsonb_build_object('hash',h,'data','am91cm5hbA=='));
 perform pg_temp.check_that(public.angler_journal_sync('missing', jsonb_build_object('hashes',jsonb_build_array(h,repeat('f',64)))) =
   jsonb_build_object('hashes',jsonb_build_array(repeat('f',64))), 'An existing chunk was requested for upload again');
 perform pg_temp.check_that(public.angler_journal_sync('missing','{"hashes":[]}') = '{"hashes":[]}'::jsonb,
   'An empty batch scheduled an upload');
 args:=jsonb_build_object('key','trip/test','revision',0,'parts',jsonb_build_array(h));
 perform pg_temp.check_that(public.angler_journal_sync('save',args)->>'revision'='1','First save failed');
 perform pg_temp.check_that(public.angler_journal_sync('save',args)->>'revision'='1','Retry changed version');
 perform pg_temp.as_user(72);
 perform pg_temp.check_that(public.angler_journal_sync('settings','{}')->>'enabled'='false','Another account setting visible');
 perform pg_temp.check_that(public.angler_journal_sync('list','{}')->'rows'='[]','Another journal visible');
 perform pg_temp.check_that(public.angler_journal_sync('missing',jsonb_build_object('hashes',jsonb_build_array(h))) =
   jsonb_build_object('hashes',jsonb_build_array(h)), 'The missing check revealed another owner''s chunk');
 begin perform public.angler_journal_sync('get',jsonb_build_object('hash',h));raise exception 'Read another owner';
 exception when no_data_found then null;end;
 perform pg_temp.as_user(71);
 args:=jsonb_set(args,'{parts}','[]');
 begin perform public.angler_journal_sync('save',args);raise exception 'Stale deletion succeeded';
 exception when sqlstate 'PT409' then null;end;
 perform pg_temp.check_that(public.angler_journal_sync('save',args||'{"revision":1}')->>'revision'='2','Deletion failed');
end $$;
reset role;
