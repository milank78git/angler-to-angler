\ir ../supabase/migrations/20261127134328_distinguish_mixed_script_nicknames.sql
do $$
declare person uuid;
begin
  perform pg_temp.as_user(85); person:=auth.uid();
  begin
    update angler_private.profiles set display_name=U&'\0392ob Kemp' where user_id=person;
    raise exception 'Expected the mixed-script error';
  exception when sqlstate 'AN003' then null; end;
  begin
    update angler_private.profiles set display_name='A' where user_id=person;
    raise exception 'Expected the length constraint';
  exception when check_violation then null; end;
  update angler_private.profiles set display_name=U&'Bob \039A\03B5\03BC\03C0' where user_id=person;
end $$;
