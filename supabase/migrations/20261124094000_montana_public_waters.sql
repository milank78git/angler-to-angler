-- These existing atlas and discussion targets also accept opt-in card and offer references.
insert into angler_public_cards.waters (key, label) values
  ('US-MT:39754243', 'Johnsrud Park · Montana FWP'),
  ('US-MT:39754165', 'Ross Toole · Montana FWP'),
  ('US-MT:39754559', 'Angevine · Montana FWP')
on conflict (key) do update set label = excluded.label;
