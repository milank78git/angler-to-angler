// A synthetic camera fix avoids publishing emulator GPS or depending on camera hardware.
(async () => {
  const { Journal } = await import('./journal.js');
  const { today } = await import('./domain.js');
  const trip = (await Journal.listTrips())[0];
  const caught = (await Journal.catches(trip.id)).find((catchRecord) => catchRecord.hasPhoto);
  const captured = Date.now();
  await Journal.saveTrip({ ...trip, day: today(trip.zone, new Date(captured)) });
  await Journal.saveCatch(
    { ...caught, capture: { captured, fixed: captured, lat: 5001, lon: 1412, accuracy: 8 } },
    await Journal.photo(caught.id),
  );
  window.confirm = () => true;
  window.evidenceSeeded = true;
})();
