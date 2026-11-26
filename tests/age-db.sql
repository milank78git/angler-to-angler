\ir ../supabase/migrations/20261126080000_age_and_guardians.sql
select pg_temp.check_that(not has_function_privilege('authenticated','public.angler_accept(text,text,text)','execute')
 and not has_table_privilege('authenticated','angler_private.guardians','insert')
 and not has_table_privilege('authenticated','angler_private.profiles','select')
 and not has_function_privilege('anon','public.angler_family_permission(uuid,uuid,text,boolean)','execute'),'Age policy grants');
insert into auth.users select ('00000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,now() from generate_series(81,85) i;
set local role authenticated;
select pg_temp.as_user(71);
do $$begin
 begin perform public.angler_group_create(gen_random_uuid(),'Missing age'); raise exception 'Missing age accepted';
 exception when insufficient_privilege then null; end;
 perform public.angler_register('Existing','2026-11-26.2','2026-11-26.2','1980-01-01');
end $$;
do $$
declare today date:=(now() at time zone 'Europe/Prague')::date; p jsonb;
begin
 for i in 81..85 loop
   perform pg_temp.as_user(i);
   begin perform public.angler_register('Age fixture','2026-11-26.2','2026-11-26.2',null);
    raise exception 'Missing birth date'; exception when sqlstate 'AN002' then null; end;
   p:=public.angler_register('Age fixture '||i,'2026-11-26.2','2026-11-26.2',
     case i when 81 then (today-interval '18 years')::date when 82 then (today-interval '15 years')::date+1
       when 83 then (today-interval '15 years')::date when 84 then (today-interval '18 years')::date+1 else '1980-01-01'::date end);
   perform pg_temp.check_that(p->>'ageBand'=case i when 81 then 'adult' when 82 then 'child' when 83 then 'teen' when 84 then 'teen' else 'adult' end
      and p->>'current'='true' and not (p ? 'born_on'),'Birthday boundary');
   if i between 82 and 84 then
    begin perform public.angler_group_create(gen_random_uuid(),'Under eighteen'); raise exception 'Underage founder';
    exception when insufficient_privilege then null; end;
   end if;
 end loop;
end $$;
reset role;
insert into angler_private.guardians(child,guardian) values('00000000-0000-4000-8000-000000000082','00000000-0000-4000-8000-000000000081');
set local role authenticated;
do $$
declare child uuid:='00000000-0000-4000-8000-000000000082'; g uuid:=gen_random_uuid(); other_g uuid:=gen_random_uuid();
  code uuid; entry uuid:=gen_random_uuid(); today date:=(now() at time zone 'Europe/Prague')::date;
  photo text:='UklGRjwAAABXRUJQVlA4IDAAAAAwAgCdASoEAAMAAQAeJaACdLoB+AH4AARoAAD+3UR/909IQNH/MH/9tDOqEv9oAAA=';
begin
 perform pg_temp.as_user(85);
 perform public.angler_group_create(g,'Family river'); perform public.angler_group_create(other_g,'Other river');
 code:=(public.angler_group_invite(g)->>'code')::uuid;
 perform pg_temp.as_user(82); perform public.angler_group_join(code);
 perform pg_temp.check_that(public.angler_profile()->>'current'='false','Legacy client opened child journal');
 begin perform public.angler_register('Changed','2026-11-26.2','2026-11-26.2','1970-01-01'); raise exception 'Edited registered birth date';
 exception when sqlstate 'AN002' then null; end;
 begin perform public.angler_group_tip_post(g,gen_random_uuid(),'tip'); raise exception 'Ungrantable tip'; exception when insufficient_privilege then null; end;
 begin perform public.angler_journal_sync('enable','{}'); raise exception 'Cloud journal accessible'; exception when insufficient_privilege then null; end;
 begin perform public.angler_market_activate(); raise exception 'Child marketplace'; exception when insufficient_privilege then null; end;
 begin perform public.angler_message_inbox(); raise exception 'Child messages'; exception when insufficient_privilege then null; end;
 begin perform public.angler_family_permission(child,g,'tip',true); raise exception 'Self approval'; exception when insufficient_privilege then null; end;
 perform pg_temp.as_user(85);
 begin perform public.angler_family_permission(child,g,'tip',true); raise exception 'Owner impersonated parent'; exception when insufficient_privilege then null; end;
 perform pg_temp.as_user(81);
 perform pg_temp.check_that(jsonb_array_length(public.angler_family_permissions()->'items')=1,'Guardian membership list');
 perform public.angler_family_permission(child,g,'tip',true);
 begin perform public.angler_family_permission(child,other_g,'catch',true); raise exception 'Nonmember permission'; exception when insufficient_privilege then null; end;
 perform pg_temp.as_user(82);
 perform public.angler_group_tip_post(g,gen_random_uuid(),'Fish the shade');
 begin perform public.angler_weekly_enter(g,entry,gen_random_uuid(),today,'Perch',photo); raise exception 'Wrong sharing scope';
 exception when insufficient_privilege then null; end;
 perform pg_temp.as_user(81);
 perform public.angler_family_permission(child,g,'catch',true);
 perform pg_temp.as_user(82);
 perform public.angler_weekly_enter(g,entry,gen_random_uuid(),today,'Perch',photo);
 perform public.angler_group_catch_post(g,entry,today-80,'Perch',250,null);
 perform public.angler_group_catch_post(g,entry,today-80,'Perch',250,null);
 perform public.angler_group_catch_post(g,gen_random_uuid(),today-100,'Pike',null,photo);
 perform pg_temp.check_that(jsonb_array_length(public.angler_group_catches(g)->'items')=2,'Historical and photo-free catches');
 begin perform public.angler_group_catch_post(g,entry,today-80,'Carp',250,null); raise exception 'Changed retry';
 exception when sqlstate 'PT409' then null; end;
 begin perform public.angler_group_catches(other_g); raise exception 'Cross-group read'; exception when insufficient_privilege then null; end;
 perform pg_temp.check_that(jsonb_array_length(public.angler_weekly_board(g)->'items')=1,'Child cannot see own group entry');
 perform pg_temp.as_user(81); perform public.angler_family_permission(child,g,'catch',false);
 perform pg_temp.as_user(85);
 perform pg_temp.check_that(jsonb_array_length(public.angler_weekly_board(g)->'items')=0 and jsonb_array_length(public.angler_group_catches(g)->'items')=0 and
   jsonb_array_length(public.angler_group_tips(g)->'tips')=1,'Withdrawal affected wrong content');
 perform pg_temp.as_user(82); perform public.angler_group_leave(g);
 perform pg_temp.as_user(85); code:=(public.angler_group_invite(g)->>'code')::uuid;
 perform pg_temp.as_user(82); perform public.angler_group_join(code);
 begin perform public.angler_group_tip_post(g,gen_random_uuid(),'Old permission'); raise exception 'Rejoined with old permission';
 exception when insufficient_privilege then null; end;
 perform pg_temp.as_user(83);
 perform pg_temp.check_that(public.angler_my_details()->>'age'='15','Private age is not derived');
end $$;
reset role;
