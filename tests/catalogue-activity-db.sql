-- Start with a real receipt in the old format before upgrading the column and RPCs.
set local role authenticated;
select pg_temp.as_user(85);
select public.angler_activity_change('20000000-0000-4000-8000-000000000085',0,'CZ:401009','2024-02-01','pike','fly',1);
select public.angler_trip_species('20000000-0000-4000-8000-000000000085',1,1,'{"Esox lucius":1}');
reset role;
\ir ../supabase/migrations/20261126140000_catalogue_activity_targets.sql

select pg_temp.check_that(not has_function_privilege('anon','public.angler_activity_change(uuid,int,text,date,text,text,int)','execute')
  and not has_function_privilege('authenticated','angler_activity.target_key(text)','execute'),'Target grants');
set local role authenticated;
do $$
declare id uuid:='20000000-0000-4000-8000-000000000085'; w text:='CZ:401009'; m date:='2024-02-01';
  receipt jsonb; saved jsonb; pair record; summary jsonb;
begin
  perform pg_temp.as_user(85);
  receipt:=public.angler_activity_state(id);
  perform pg_temp.check_that(receipt#>>'{entry,target}'='pike' and receipt->>'revision'='1','Lost pre-upgrade target');
  perform pg_temp.check_that(public.angler_activity_change(id,0,w,m,'Esox lucius','fly',1)=receipt
    and public.angler_trip_species(id)->'counts'='{"Esox lucius":1}'::jsonb,'Alias retry invalidated shared counts');
  saved:=public.angler_activity_change(id,1,w,m,'Cyprinus carpio','bottom',0);
  perform pg_temp.check_that(saved#>>'{entry,target}'='Cyprinus carpio' and saved#>>'{entry,fish}'='0'
    and public.angler_activity_state(id)=saved and public.angler_activity_change(id,1,w,m,'Cyprinus carpio','bottom',0)=saved,
    'Blank carp trip was lost or counted twice');
  perform pg_temp.check_that(public.angler_activity_mine()->'items' @> jsonb_build_array(saved),'Missing catalogue target in history');
  begin perform public.angler_activity_change(id,2,w,m,'Free text','fly',0); raise exception 'Unlisted fish accepted';
  exception when sqlstate 'PT422' then null; end;
  begin perform public.angler_activity_summary(w,m,'Free text'); raise exception 'Unlisted filter accepted';
  exception when sqlstate 'PT422' then null; end;
  begin perform public.angler_activity_change(id,1,w,m,'other','fly',0); raise exception 'Stale edit accepted';
  exception when sqlstate 'PT409' then null; end;
  perform pg_temp.check_that(public.angler_activity_summary(w,m,'Cyprinus carpio')->'sample'='null'::jsonb,
    'Single carp trip exposed');
  perform pg_temp.check_that(public.angler_activity_change(id,2)->'entry'='null'::jsonb,'Withdrawal failed');
  for pair in select * from (values ('pike','Esox lucius'),('zander','Sander lucioperca'),
      ('barbel','Barbus barbus'),('roach','Rutilus rutilus'),('other','other'),('unspecified','unspecified')) p(old_key,new_key)
  loop
    id:=gen_random_uuid();
    receipt:=public.angler_activity_change(id,0,w,m,pair.old_key,'fly',0);
    perform pg_temp.check_that(public.angler_activity_change(id,0,w,m,pair.new_key,'fly',0)=receipt
      and receipt#>>'{entry,target}'=pair.old_key,'Incompatible target '||pair.old_key);
  end loop;
  -- A new species can form a publishable cell under the existing independent-review rules.
  m:='2024-03-01';
  for n in 910..914 loop
    perform pg_temp.as_user(n);
    perform public.angler_register('Verified sample '||n,'2026-11-26.2','2026-11-26.2','1980-01-01');
    perform public.angler_activity_change(gen_random_uuid(),0,w,m,'Cyprinus carpio','fly',0);
    perform public.angler_activity_change(gen_random_uuid(),0,w,m,'Cyprinus carpio','fly',2);
  end loop;
  summary:=public.angler_activity_summary(w,m,'Cyprinus carpio','fly')->'sample';
  perform pg_temp.check_that(summary='{"trips":10,"anglers":5,"fish":10,"successfulTrips":5}'::jsonb,
    'Published carp totals or blank trips were incorrect');
end $$;
reset role;
