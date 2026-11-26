-- Expand nickname uniqueness while preserving displayed spellings, profile IDs and prior audit history.
-- Unicode 17.0: DerivedCoreProperties.txt (Default_Ignorable_Code_Point), Scripts.txt and
-- security/confusables.txt. The versioned product rule compares single Latin/Cyrillic letters
-- with a shared UTS #39 prototype across either case. Each Cyrillic letter maps to one
-- Latin representative, preferring ASCII and then lowercase matches. Latin letters and
-- accents stay distinct. These are comparison keys only, never display text.
-- The Unicode data license is reproduced in NOTICE.
lock table angler_private.profiles in share row exclusive mode;

-- An expression index stores the old keys. Rebuild it in the same transaction as the new rule.
drop index angler_private.profiles_unique_nickname;
create or replace function angler_private.nickname_key(value text) returns text
language sql immutable strict set search_path='' as $$
  -- The supported Linux/PostgreSQL deployments include C.utf8. Pinning it also folds
  -- uppercase Cyrillic when the database default is C.
  with visible as (
    select regexp_replace(value collate "C",
      U&'[\00AD\034F\061C\115F-\1160\17B4-\17B5\180B-\180F\200B-\200F\202A-\202E\2060-\206F\3164\FE00-\FE0F\FEFF\FFA0\FFF0-\FFF8\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0000-\+0E0FFF]', '', 'g') collate pg_catalog."C.utf8" as name
  ), folded as (
    select lower(btrim(regexp_replace(normalize(name, NFKC), '[[:space:]]+', ' ', 'g'))) as name from visible
  )
  select normalize(translate(normalize(name, NFD),
      'абвгезиклмно' ||
      'рстуфхшьяєѕі' ||
      'јљћѡѣѳѵҍғқҟң' ||
      'үұһҽӏӕәӡөԁԋԍ' ||
      'ԑԛԝꙅꙇꙍꙩꚕꚙ',
      'aƃbreɜᴎkʌmho' ||
      'pctyɸxwbᴙɛsi' ||
      'jꭠħwƀɵvƀɍⱪꝁⱨ' ||
      'yɏhelæǝȝɵdƕg' ||
      'ɛqwƨiꞷʘɦꝏ'), NFC) from folded;
$$;

-- Keep the oldest spelling per group. All proposed suffixes are checked against the entire
-- table, including nicknames which already use a suffix and profiles repaired by an older migration.
do $$
declare
  p record;
  base text;
  suffix text;
  candidate text;
  attempt integer;
begin
  for p in
    select * from (
      select user_id, display_name, angler_private.nickname_key(display_name) as key,
        row_number() over (partition by angler_private.nickname_key(display_name)
                           order by created_at, user_id) as position
      from angler_private.profiles
    ) ranked where position > 1 or length(key) < 2 order by user_id
  loop
    base := case when length(p.key) < 2 then 'Angler' else p.display_name end;
    attempt := 0;
    loop
      suffix := ' #' || left(replace(p.user_id::text, '-', ''), 8)
        || case when attempt = 0 then '' else '-' || attempt::text end;
      candidate := left(base, 60 - length(suffix)) || suffix;
      exit when not exists (
        select from angler_private.profiles
        where user_id <> p.user_id and angler_private.nickname_key(display_name) = angler_private.nickname_key(candidate)
      );
      attempt := attempt + 1;
    end loop;
    update angler_private.profiles set display_name = candidate,
      original_display_name = coalesce(original_display_name, p.display_name) where user_id = p.user_id;
  end loop;
end $$;

create unique index profiles_unique_nickname on angler_private.profiles(angler_private.nickname_key(display_name));
alter table angler_private.profiles add constraint profiles_visible_nickname
  check (length(angler_private.nickname_key(display_name)) >= 2);
