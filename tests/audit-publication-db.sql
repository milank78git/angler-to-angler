-- Existing collisions, including a historical name that already occupies a proposed suffix.
insert into auth.users select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid, now() from generate_series(895,897) n;
insert into angler_private.profiles(user_id,display_name,created_at) values
 ('00000000-0000-4000-8000-000000000895','Silver pike','2026-01-01'),
 ('00000000-0000-4000-8000-000000000896','Silver PIKE','2026-02-01'),
 ('00000000-0000-4000-8000-000000000897','Silver PIKE #00000000','2026-03-01');
\ir ../supabase/migrations/20261126021000_audit_publication_controls.sql
select pg_temp.check_that((select display_name='Silver pike' and original_display_name is null
 from angler_private.profiles where user_id='00000000-0000-4000-8000-000000000895'), 'Oldest name changed');
select pg_temp.check_that((select display_name='Silver PIKE #00000000-1' and original_display_name='Silver PIKE'
 from angler_private.profiles where user_id='00000000-0000-4000-8000-000000000896'), 'Historical collision lost');
select pg_temp.check_that(not exists(select from angler_private.profiles group by angler_private.nickname_key(display_name) having count(*)>1), 'Ambiguous public display names');
select pg_temp.check_that(angler_private.nickname_key(' Blue   river ')=angler_private.nickname_key('BLUE River'), 'Canonical name differs');
select pg_temp.check_that(not has_function_privilege('authenticated','angler_activity.reviewed_contributor(uuid)','execute'), 'Review eligibility must stay private');

-- Reacceptance is idempotent, but a different account cannot claim the same visible name.
insert into auth.users values
 ('00000000-0000-4000-8000-000000000901',now()),('00000000-0000-4000-8000-000000000902',now());
set local role authenticated;
select pg_temp.as_user(901);
select public.angler_accept('Northern Pike','2026-11-23','2026-11-23');
select pg_temp.as_user(902);
do $$begin
 begin perform public.angler_accept(' northern   PIKE ','2026-11-23','2026-11-23');
   raise exception 'Duplicate name accepted'; exception when sqlstate 'PT409' then null; end;
 perform public.angler_accept('Daybreak Pike','2026-11-23','2026-11-23');
 perform public.angler_accept('Northern Pike','2026-11-23','2026-11-23');
end$$;
reset role;
-- Ten shared trips from five newly created accounts cannot unlock any of the three public projections.
insert into auth.users select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now() from generate_series(910,914) n;
set local role authenticated;
do $$declare period date:=(date_trunc('month',(timezone('Europe/Prague',now())::date-7)::timestamp)-interval '1 month')::date;
 id uuid; version int;
begin
 for n in 910..914 loop
   perform pg_temp.as_user(n);
   perform public.angler_accept('Verified sample '||n,'2026-11-23','2026-11-23');
   for i in 1..2 loop
     id:=gen_random_uuid();
     version:=(public.angler_activity_change(id,0,'CZ:401009',period,'pike','fly',1)->>'revision')::int;
     perform public.angler_trip_species(id,version,(public.angler_trip_species(id)->>'version')::bigint,'{"Esox lucius":1}');
   end loop;
 end loop;
 perform pg_temp.check_that(public.angler_activity_summary('CZ:401009',period)->'sample'='null'::jsonb,'Unreviewed accounts unlocked water detail');
 perform pg_temp.check_that(not(public.angler_top_waters()->'waters' @> '[{"water":"CZ:401009"}]'),'Unreviewed accounts unlocked visits');
 perform pg_temp.check_that(not(public.angler_top_species()->'species' @> '[{"latin":"Esox lucius"}]'),'Unreviewed accounts unlocked species');
end$$;
reset role;
insert into angler_private.catch_evidence(user_id,catch_id,species,captured_at,fingerprint,outcome,length_mm,reviewer)
 select user_id,gen_random_uuid(),'Pike',now(),sha256(convert_to(user_id::text,'UTF8')),'measured',300,
 '00000000-0000-4000-8000-000000000901'::uuid from angler_private.profiles where display_name like 'Verified sample %';
set local role authenticated;
do $$declare period date:=(date_trunc('month',(timezone('Europe/Prague',now())::date-7)::timestamp)-interval '1 month')::date;
begin
 perform pg_temp.check_that((public.angler_activity_summary('CZ:401009',period)->'sample'->>'trips')::int>=10,'Reviewed cohort missing');
 perform pg_temp.check_that(public.angler_top_waters()->'waters' @> '[{"water":"CZ:401009"}]','Reviewed visit sample missing');
 perform pg_temp.check_that(public.angler_top_species()->'species' @> '[{"latin":"Esox lucius"}]','Reviewed fish sample missing');
end$$;
reset role;
-- A known water supplies the authoritative day, even when an older or differently configured client submits it.
insert into angler_discussions.waters(key,zone) values('ZZ:TEST:EAST','Pacific/Kiritimati'),('ZZ:TEST:WEST','Pacific/Pago_Pago');
insert into angler_public_cards.waters(key,label) values('ZZ:TEST:EAST','East test water'),('ZZ:TEST:WEST','West test water');
set local role authenticated;
select pg_temp.as_user(901);
do $$declare eastern date:=(statement_timestamp() at time zone 'Pacific/Kiritimati')::date;
 draft jsonb:=jsonb_build_object('title','Date boundary','species','Esox lucius','access','shore','day',eastern,
 'water','ZZ:TEST:EAST','technique','Date boundary test','price',1,'limit',null);
begin
 perform public.angler_market_publish(gen_random_uuid(),0,draft);
 begin perform public.angler_market_publish(gen_random_uuid(),0,draft||'{"water":"ZZ:TEST:WEST","timeZone":"Pacific/Kiritimati"}');
   raise exception 'A future day in the water zone was accepted'; exception when sqlstate 'PT422' then null; end;
 perform public.angler_market_publish(gen_random_uuid(),0,draft||'{"water":null,"timeZone":"Pacific/Kiritimati"}');
 begin perform public.angler_market_publish(gen_random_uuid(),0,draft||'{"water":null,"timeZone":"Invalid/Example"}');
   raise exception 'Invalid private zone accepted'; exception when sqlstate 'PT422' then null; end;
end$$;
reset role;
