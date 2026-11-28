\ir ../supabase/migrations/20261128030000_age_correction_journal_epoch.sql

do $$
declare actor uuid; original date; young date := (current_date - interval '14 years')::date;
  old_args jsonb; settings jsonb; fresh jsonb; h text := repeat('c',64);
begin
  perform pg_temp.as_user(83);
  actor := auth.uid();
  select born_on into strict original from angler_private.profiles where user_id=actor;
  old_args := jsonb_build_object('epoch',public.angler_journal_sync('settings','{}')->'epoch');
  perform public.angler_journal_sync('enable',old_args||'{"consent":true}');
  insert into angler_sync.documents(owner,key,revision,parts) values(actor,'trip/correction',1,array[h]);
  insert into angler_sync.photos(owner,trip,catch_id,digest,object_id,size,expires,attached)
    values(actor,'trip/correction','catch',h,gen_random_uuid(),4,now()+interval '1 month',true);
  insert into angler_sync.photo_parts(owner,digest,part,bytes) values(actor,h,0,'test');
  update angler_sync.accounts set deletion_floor=17 where owner=actor;
  perform angler_private.correct_birth_date(actor,original,young);
  perform pg_temp.check_that(not exists(select from angler_sync.documents where owner=actor)
    and not exists(select from angler_sync.photos where owner=actor)
    and not exists(select from angler_sync.photo_parts where owner=actor)
    and not exists(select from angler_sync.chunks where owner=actor)
    and not exists(select from angler_sync.usage where owner=actor),'Age change retained cloud data');
  begin perform public.angler_journal_sync('list',old_args); raise exception 'Child retained cloud access';
  exception when insufficient_privilege then null; end;

  perform angler_private.correct_birth_date(actor,young,original);
  settings := public.angler_journal_sync('settings','{}');
  perform pg_temp.check_that(settings->>'enabled'='false' and settings->>'epoch' is not null
    and settings->>'epoch' is distinct from old_args->>'epoch','Missing age erasure epoch');
  begin perform public.angler_journal_sync('list',old_args); raise exception 'Stale phone received a list';
  exception when sqlstate 'PT410' then null; end;
  fresh := jsonb_build_object('epoch',settings->'epoch');
  begin perform public.angler_journal_sync('enable',fresh); raise exception 'Re-enabled without consent';
  exception when sqlstate 'PT410' then null; end;
  perform public.angler_journal_sync('enable',fresh||'{"consent":true}');
  perform pg_temp.check_that(public.angler_journal_sync('list',fresh) @> '{"rows":[],"floor":0}',
    'New copy inherited deleted documents or floor');
  begin perform public.angler_journal_sync('list',old_args); raise exception 'Stale phone joined new copy';
  exception when sqlstate 'PT410' then null; end;
end $$;
