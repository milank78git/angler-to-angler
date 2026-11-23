\ir ../supabase/migrations/20261123153421_water_discussions.sql
select pg_temp.check_that(not has_table_privilege('authenticated','angler_discussions.posts','select')
  and not has_table_privilege('authenticated','angler_discussions.reports','insert')
  and not has_function_privilege('authenticated','angler_discussions.remove_content(text,uuid,uuid)','execute')
  and not has_function_privilege('anon','public.angler_water_discussion(text,uuid,bigint)','execute'),'Unexpected discussion privileges');
set local role authenticated;
do $$
declare q uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); own_reply uuid:=gen_random_uuid();
  water text:='CZ:401001'; other_water text:='CZ:401009'; day date:=date '2026-01-10';
  page jsonb; older bigint; answer text:=E'Use shade <slowly> & pause.\nAlong the bank.';
begin
  perform pg_temp.as_user(4);
  begin perform public.angler_water_discussion(water); raise exception 'Unconfirmed reader'; exception when insufficient_privilege then null; end;
  perform pg_temp.as_user(2);
  begin perform public.angler_water_discussion('UNKNOWN'); raise exception 'Unknown water accepted'; exception when sqlstate 'PT404' then null; end;
  begin perform public.angler_discussion_post(water,null,q,'   ',null); raise exception 'Blank question'; exception when invalid_parameter_value then null; end;
  begin perform public.angler_discussion_post(water,null,q,'Where?',day); raise exception 'Outing accepted on question'; exception when invalid_parameter_value then null; end;
  perform public.angler_discussion_post(water,null,q,'Anyone fished this bank?',null);
  perform public.angler_discussion_post(water,null,q,'Anyone fished this bank?',null);
  perform pg_temp.check_that(jsonb_array_length(public.angler_water_discussion(water)->'items')=1
    and public.angler_water_discussion(other_water)->'items'='[]'::jsonb,'Water isolation or duplicate question');
  perform pg_temp.as_user(3);
  begin perform public.angler_discussion_post(water,null,q,'Anyone fished this bank?',null); raise exception 'Foreign request reused'; exception when sqlstate 'PT409' then null; end;
  begin perform public.angler_water_discussion(other_water,q); raise exception 'Cross-water thread'; exception when sqlstate 'PT404' then null; end;
  begin perform public.angler_discussion_post(other_water,q,a,answer,day); raise exception 'Cross-water reply'; exception when sqlstate 'PT404' then null; end;
  begin perform public.angler_discussion_post(water,q,a,answer,current_date+2); raise exception 'Future outing'; exception when invalid_parameter_value then null; end;
  perform public.angler_discussion_post(water,q,a,answer,day);
  perform public.angler_discussion_post(water,q,a,answer,day);
  begin perform public.angler_discussion_post(water,q,a,'Changed',day); raise exception 'Different retry'; exception when sqlstate 'PT409' then null; end;
  begin perform public.angler_discussion_post(water,a,gen_random_uuid(),'Nested',null); raise exception 'Nested reply'; exception when sqlstate 'PT404' then null; end;
  begin perform public.angler_discussion_withdraw(water,q); raise exception 'Other author withdrew question'; exception when sqlstate 'PT404' then null; end;
  begin perform public.angler_discussion_helpful(water,a,true); raise exception 'Answer author marked reply'; exception when sqlstate 'PT404' then null; end;
  perform public.angler_discussion_report(water,q); perform public.angler_discussion_report(water,q);
  page:=public.angler_water_discussion(water,q);
  perform pg_temp.check_that(page->'question'->>'reported'='true' and page->'question'->>'mine'='false'
    and page->'items'->0->>'mine'='true' and page->'items'->0->>'body'=answer
    and page->'items'->0->>'tripDay'=day::text and page->'items'->0 ? 'postedAt','Thread projection');
  perform pg_temp.as_user(2);
  perform pg_temp.check_that(public.angler_water_discussion(water)->'items'->0->>'replyCount'='1'
    and public.angler_water_discussion(water,q)->'question'->>'reported'='false','Leaked flag or wrong answer count');
  perform public.angler_discussion_helpful(water,a,true);perform public.angler_discussion_helpful(water,a,true);
  perform pg_temp.check_that(public.angler_water_discussion(water,q)->'items'->0->>'helpful'='true','Mark not retained');
  perform public.angler_discussion_helpful(water,a,false);
  perform public.angler_discussion_post(water,q,own_reply,'Follow-up',null);
  begin perform public.angler_discussion_helpful(water,own_reply,true); raise exception 'Marked own reply'; exception when sqlstate 'PT404' then null; end;
  for n in 1..20 loop perform public.angler_discussion_post(water,q,gen_random_uuid(),'Reply '||n,null);end loop;
  page:=public.angler_water_discussion(water,q);older:=(page->>'next')::bigint;
  perform pg_temp.check_that(jsonb_array_length(page->'items')=20 and page->'items'->0->>'body'='Reply 20','First page limit/order');
  perform public.angler_discussion_post(water,q,gen_random_uuid(),'Fresh reply',null);
  page:=public.angler_water_discussion(water,q,older);
  perform pg_temp.check_that(jsonb_array_length(page->'items')=2 and page->'items'->1->>'body'=answer and page->>'next' is null,'Unstable cursor');
  perform pg_temp.as_user(3);
  perform public.angler_discussion_withdraw(water,a);
  begin perform public.angler_discussion_post(water,q,a,answer,day); raise exception 'Withdrawn answer republished'; exception when sqlstate 'PT409' then null; end;
  perform pg_temp.as_user(2);
  perform public.angler_discussion_withdraw(water,q);perform public.angler_discussion_withdraw(water,q);
  perform pg_temp.check_that(public.angler_water_discussion(water)->'items'='[]'::jsonb,'Withdrawn question visible');
  begin perform public.angler_discussion_post(water,q,gen_random_uuid(),'Late',null); raise exception 'Late reply'; exception when sqlstate 'PT404' then null; end;
  begin perform public.angler_water_discussion(water,q,older); raise exception 'Withdrawn thread visible'; exception when sqlstate 'PT404' then null; end;
end$$;
reset role;
select pg_temp.check_that(not exists(select from angler_discussions.reports)
  and not exists(select from angler_discussions.posts where body is not null or trip_day is not null),'Withdrawal cleanup failed');
