\ir ../supabase/migrations/20261125075258_private_journal_sync.sql
set local role authenticated;
select pg_temp.as_user(71);
do $$declare h text:=encode(sha256('journal'::bytea),'hex'); args jsonb; begin
 perform pg_temp.check_that(public.angler_journal_sync('settings','{}')->>'enabled'='false','Unexpected sync setting');
 perform public.angler_journal_sync('enable','{}');
 perform pg_temp.check_that(public.angler_journal_sync('settings','{}')->>'enabled'='true','Account setting not persisted');
 perform public.angler_journal_sync('put',jsonb_build_object('hash',h,'data','am91cm5hbA=='));
 args:=jsonb_build_object('key','trip/test','revision',0,'parts',jsonb_build_array(h));
 perform pg_temp.check_that(public.angler_journal_sync('save',args)->>'revision'='1','First save failed');
 perform pg_temp.check_that(public.angler_journal_sync('save',args)->>'revision'='1','Retry changed version');
 perform pg_temp.as_user(72);
 perform pg_temp.check_that(public.angler_journal_sync('settings','{}')->>'enabled'='false','Another account setting visible');
 perform pg_temp.check_that(public.angler_journal_sync('list','{}')->'rows'='[]','Another journal visible');
 begin perform public.angler_journal_sync('get',jsonb_build_object('hash',h));raise exception 'Read another owner';
 exception when no_data_found then null;end;
 perform pg_temp.as_user(71);
 args:=jsonb_set(args,'{parts}','[]');
 begin perform public.angler_journal_sync('save',args);raise exception 'Stale deletion succeeded';
 exception when sqlstate 'PT409' then null;end;
 perform pg_temp.check_that(public.angler_journal_sync('save',args||'{"revision":1}')->>'revision'='2','Deletion failed');
end $$;
reset role;
