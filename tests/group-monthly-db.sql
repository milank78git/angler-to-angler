\ir ../supabase/migrations/20261124120626_optional_group_monthly_challenge.sql
set local role authenticated;
do $$
declare g uuid:=gen_random_uuid(); invite uuid; e uuid:=gen_random_uuid(); who integer;
  result jsonb; today date:=timezone('Europe/Prague',now())::date;
  pixels text:='UklGRjwAAABXRUJQVlA4IDAAAAAwAgCdASoEAAMAAQAeJaACdLoB+AH4AARoAAD+3UR/909IQNH/MH/9tDOqEv9oAAA=';
begin
  perform pg_temp.as_user(71); perform public.angler_group_create(g,'Monthly board');
  invite:=(public.angler_group_invite(g)->>'code')::uuid;
  perform pg_temp.as_user(72); perform public.angler_group_join(invite);
  perform public.angler_weekly_enter(g,e,gen_random_uuid(),today,'Perch',pixels);
  perform pg_temp.as_user(71); perform public.angler_weekly_vote(g,e,true);
  perform pg_temp.check_that(public.angler_group_monthly(g)->'items'='[]','Group ranking must be opt-in');
  perform pg_temp.as_user(72); result:=public.angler_group_monthly(g,true);
  perform pg_temp.check_that(result->>'joined'='true' and result->'items'->0->>'score'='1','Visible opted-in result');
  perform pg_temp.as_user(151);
  begin perform public.angler_group_monthly(g); raise exception 'Outsider read monthly board';
  exception when insufficient_privilege or sqlstate 'PT403' then null; end;
  perform pg_temp.as_user(72); result:=public.angler_group_monthly(g,false);
  perform pg_temp.check_that(result->'items'='[]','Withdrawn angler still ranked');
end $$;
reset role;
