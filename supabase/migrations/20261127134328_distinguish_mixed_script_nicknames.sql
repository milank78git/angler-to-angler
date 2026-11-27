create or replace function angler_private.check_nickname_scripts() returns trigger
language plpgsql set search_path='' as $$
declare word text; scripts integer;
begin
  if tg_op='UPDATE' and new.display_name=old.display_name then return new; end if;
  for word in select regexp_split_to_table(normalize(new.display_name,NFKC) collate pg_catalog."C.utf8",'[[:space:][:punct:]]+') loop
    scripts := (word collate "C" ~ U&'[A-Za-z\00C0-\00D6\00D8-\00F6\00F8-\02AF\1E00-\1EFF]')::int
             + (word collate "C" ~ U&'[\0370-\0373\0376-\0377\037B-\037D\0386\0388-\038A\038C\038E-\03A1\03A3-\03E1\03F0-\03FF\1F00-\1FFF]')::int
             + (word collate "C" ~ U&'[\0400-\0481\048A-\052F\A640-\A69B]')::int;
    if scripts>1 then raise exception 'Mixed writing systems within a nickname word' using errcode='AN003'; end if;
  end loop;
  return new;
end $$;
