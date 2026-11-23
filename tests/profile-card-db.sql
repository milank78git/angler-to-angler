\ir ../supabase/migrations/20261123112814_angler_profile_cards.sql

select pg_temp.check_that(not has_function_privilege('anon','public.angler_card(uuid)','execute')
  and not has_table_privilege('authenticated','angler_private.catch_evidence','update')
  and not has_table_privilege('authenticated','angler_private.catch_reviewers','insert')
  and not has_table_privilege('authenticated','angler_private.profile_cards','select'),'Unexpected client privilege');
insert into angler_private.catch_reviewers select user_id from angler_private.profiles where display_name='Angler 3';
set local role authenticated;
select pg_temp.as_user(2);
do $$
declare me uuid:='00000000-0000-4000-8000-000000000002'; gid uuid:=gen_random_uuid(); target uuid:=gen_random_uuid();
 stamp bigint:=floor(extract(epoch from now())*1000); code uuid; photograph text:=encode(decode('ffd8ff00ffd9','hex'),'base64');
begin
 perform pg_temp.check_that(public.angler_card()->>'revision'='0' and public.angler_card()->>'verifiedCount'='0','Fresh profile');
 perform public.angler_save_card(0,'Praha','By the river','About me',50,null,false);
 begin perform public.angler_save_card(0,'','','',1,null,true); raise exception 'Stale create accepted';exception when sqlstate 'PT409' then null;end;
 begin perform public.angler_save_card(1,'','','',51,null,true); raise exception 'Invalid avatar';exception when check_violation then null;end;
 perform public.angler_group_create(gid,'Secret river');
 perform pg_temp.as_user(3);
 begin perform public.angler_card(me); raise exception 'Read private card';exception when sqlstate 'PT404' then null;end;
 perform pg_temp.check_that(public.angler_directory()->'profiles'='[]'::jsonb,'Private profile in directory');
 perform pg_temp.as_user(2);
 perform public.angler_save_card(1,'Praha','Tag','About',0,photograph,true);
 perform pg_temp.check_that(public.angler_card()->'groups'->>0='Secret river','Own group missing');
 perform pg_temp.as_user(3);
 perform pg_temp.check_that(public.angler_card(me)->>'photo'=photograph and public.angler_card(me)->'groups'='[]'::jsonb
    and public.angler_directory()->'profiles'->0->>'id'=me::text,'Visibility or private group leak');
 perform pg_temp.as_user(2); code:=(public.angler_group_invite(gid)->>'code')::uuid;
 perform pg_temp.as_user(3);perform public.angler_group_join(code);
 perform pg_temp.check_that(public.angler_card(me)->'groups'->>0='Secret river','Missing mutual group');
 perform pg_temp.as_user(2);
 begin perform public.angler_evidence_review();raise exception 'Unauthorized reviewer';exception when insufficient_privilege then null;end;
 begin perform public.angler_evidence_submit(target,'Pike','River',(now() at time zone 'UTC')::date,'UTC',stamp,stamp-121000,5000,1400,10,photograph);raise exception 'Old fix accepted';exception when invalid_parameter_value then null;end;
 begin perform public.angler_evidence_submit(target,'Pike','River',(now() at time zone 'UTC')::date,'UTC',stamp,stamp,5000,1400,101,photograph);raise exception 'Imprecise fix';exception when invalid_parameter_value then null;end;
 perform public.angler_evidence_submit(target,'Pike','River',(now() at time zone 'UTC')::date,'UTC',stamp,stamp,5000,1400,10,photograph);
 perform public.angler_evidence_submit(target,'Pike','River',(now() at time zone 'UTC')::date,'UTC',stamp,stamp,5000,1400,10,photograph);
 begin perform public.angler_evidence_submit(gen_random_uuid(),'Pike','River',(now() at time zone 'UTC')::date,'UTC',stamp,stamp,5000,1400,10,photograph);raise exception 'Duplicate counted';exception when sqlstate 'PT409' then null;end;
 perform pg_temp.check_that(public.angler_card()->>'verifiedCount'='0' and jsonb_array_length(public.angler_evidence_list(null,null)->'items')=1,'Pending state');
 perform pg_temp.as_user(3);
 perform pg_temp.check_that(public.angler_evidence_review()->'item'->>'photo'=photograph and public.angler_evidence_list(null,null)->'items'='[]'::jsonb,'Review isolation');
 begin perform public.angler_evidence_decide(me,target,'measured',null);raise exception 'Missing length accepted';exception when invalid_parameter_value then null;end;
 perform public.angler_evidence_decide(me,target,'estimated',650);
 begin perform public.angler_evidence_decide(me,target,'measured',660);raise exception 'Duplicate decision accepted';exception when sqlstate 'PT409' then null;end;
 perform pg_temp.check_that(public.angler_card(me)->>'verifiedCount'='1' and public.angler_evidence_review()->'item'='null'::jsonb,'Incorrect verified count');
 perform public.angler_evidence_remove(target);
 perform pg_temp.check_that(public.angler_card(me)->>'verifiedCount'='1','Other account removed verification');
 perform pg_temp.as_user(2);
 perform pg_temp.check_that(public.angler_evidence_list(null,null,target)->'items'->0->>'mm'='650','Reviewed estimate missing');
 perform public.angler_evidence_remove(target);
 perform pg_temp.check_that(public.angler_card()->>'verifiedCount'='0','Removal left a verified count');
 -- Measured and rejected submissions follow the same queue and have different counting rules.
 foreach photograph in array array['/9j/AP/Z','/9j/Af/Z'] loop
   target:=gen_random_uuid();
   perform public.angler_evidence_submit(target,'Pike','River',current_date,'UTC',stamp,stamp,5000,1400,10,photograph);
   perform pg_temp.as_user(3);
   if photograph='/9j/AP/Z' then perform public.angler_evidence_decide(me,target,'measured',520);
   else perform public.angler_evidence_decide(me,target,'unverified',null); end if;
   perform pg_temp.as_user(2);
 end loop;
 perform pg_temp.check_that(public.angler_card()->>'verifiedCount'='1','Measured/rejected count');
 perform public.angler_save_card(2,'','','',1,null,false);
 perform pg_temp.as_user(3);
 begin perform public.angler_card(me);raise exception 'Unpublished card leaked';exception when sqlstate 'PT404' then null;end;
 photograph:='/9j/Av/Z';
 perform public.angler_evidence_submit(target,'Pike','River',(now() at time zone 'UTC')::date,'UTC',stamp,stamp,5000,1400,10,photograph);
 perform pg_temp.check_that(public.angler_evidence_review()->'item'='null'::jsonb,'Owner in own review queue');
 begin perform public.angler_evidence_decide('00000000-0000-4000-8000-000000000003',target,'measured',500);
   raise exception 'Self review';exception when sqlstate 'PT409' then null;end;
end$$;
reset role;
select pg_temp.check_that(not exists(select from angler_private.catch_evidence where outcome<>'pending'
 and (photo is not null or water is not null or lat100 is not null or lon100 is not null)),'Decided records retained location or pixels');
