\ir ../supabase/migrations/20261125045854_community_parking.sql
\ir ../supabase/migrations/20261125153400_parking_edit_ownership.sql
set local role authenticated;
select pg_temp.as_user(71);
do $$
declare w text := 'CZ:401001'; p uuid := gen_random_uuid(); other_water text := 'CZ:401009';
  seed uuid := md5('parking.pikovice')::uuid; response jsonb;
begin
  perform public.angler_parking_save(w,p,0,49.91,14.10,'Pier');
  perform public.angler_parking_save(w,p,0,49.91,14.10,'Pier');
  perform pg_temp.check_that(public.angler_parking_waters()->'waters' ? w,'Missing from parking filter');
  perform pg_temp.as_user(72);
  perform pg_temp.check_that(jsonb_array_length(public.angler_parking_list(w)->'points')=1
    and public.angler_parking_list(w)->'points'->0->>'name'='Pier','Second account cannot see saved point');
  perform public.angler_parking_review(p,4,'Gravel entrance');
  perform pg_temp.as_user(71);
  response:=public.angler_parking_review(p,null,'Gate closes at night');
  perform pg_temp.check_that((response->>'votes')::int=1 and (response->>'notes')::int=2
    and response->'items' ? 'Gravel entrance' and response->>'myStars' is null,'Notes-only review failed');
  perform public.angler_parking_review(p,2,'');
  perform public.angler_parking_review(p,2,'');
  perform pg_temp.as_user(72);
  response:=public.angler_parking_feedback(p);
  perform pg_temp.check_that((response->>'average')::numeric=3 and (response->>'votes')::int=2
    and (response->>'notes')::int=1 and response->>'myNote'='Gravel entrance','Feedback not isolated');
  perform pg_temp.check_that((public.angler_parking_list(w)->'points'->0->>'canEdit')::boolean=false,'Unexpected edit action');
  begin perform public.angler_parking_save(w,p,1,49.92,14.11,'Gate');
    raise exception 'Foreign edit accepted'; exception when sqlstate 'PT403' then null; end;
  perform pg_temp.as_user(71);
  perform pg_temp.check_that((public.angler_parking_list(w)->'points'->0->>'canEdit')::boolean,'Owner cannot edit');
  perform public.angler_parking_save(w,p,1,49.92,14.11,'Gate');
  perform public.angler_parking_save(w,p,1,49.92,14.11,'Gate');
  begin perform public.angler_parking_save(w,p,1,49.93,14.11,'Stale edit');
    raise exception 'Lost concurrent edit'; exception when sqlstate 'PT409' then null; end;
  begin perform public.angler_parking_save(other_water,p,2,49.1,14.2,'Wrong water');
    raise exception 'Point moved between waters'; exception when sqlstate 'PT409' then null; end;
  begin perform public.angler_parking_save(w,gen_random_uuid(),0,49.92,14.11,null);
    raise exception 'Duplicate point'; exception when sqlstate 'PT409' then null; end;
  begin perform public.angler_parking_save(w,gen_random_uuid(),0,99,14,'Invalid');
    raise exception 'Invalid coordinate accepted'; exception when sqlstate 'PT422' then null; end;
  begin perform public.angler_parking_review(p,6,null); raise exception 'Invalid score accepted';
    exception when sqlstate 'PT422' then null; end;
  perform pg_temp.as_user(72);
  response:=public.angler_parking_review(p,null,null);
  perform pg_temp.check_that((response->>'votes')::int=1 and (response->>'notes')::int=0,'Withdrawal affected another account');
  begin perform public.angler_parking_save(other_water,seed,1,49.877,14.426,null);
    raise exception 'Bundled point edited'; exception when sqlstate 'PT403' then null; end;
  perform pg_temp.check_that(not has_function_privilege('anon','public.angler_parking_list(text)','execute')
    and not has_table_privilege('authenticated','angler_activity.parking_points','update'),'Unexpected parking privilege');
end $$;
reset role;
