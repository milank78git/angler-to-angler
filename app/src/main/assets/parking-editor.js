import { mercator } from './atlas-basemap.js';
import { atlasMap, waterPoint } from './world-map.js';
import { countryBorders } from './country-lookup.js';
import { rpc, failure } from './profile-api.js';
import { newJournalId } from './journal.js';
import { by, back, bindBack, button, confirmAction, esc, screen, submitChange, t, toast } from './ui.js';

/** When the publisher has no reference point, show the country without preselecting a parking spot. */
async function countryCamera(code) {
  const borders = await countryBorders(code === 'US' ? 'us' : 'europe').catch(() => ({}));
  const rings = (borders[code] || []).map(polygon => polygon[0]).filter(ring => ring?.length);
  if (!rings.length) return null;
  const ring = rings.reduce((largest, next) => next.length > largest.length ? next : largest);
  let left=1, top=1, right=0, bottom=0;
  for (const coordinates of ring) {
    const [x,y] = mercator(coordinates);
    left=Math.min(left,x); right=Math.max(right,x); top=Math.min(top,y); bottom=Math.max(bottom,y);
  }
  return {x:(left+right)/2, y:(top+bottom)/2, level:Math.min(13,Math.max(1,Math.log2(1/Math.max(right-left,bottom-top,0.0001))))};
}

export async function parkingEditor({view,nav,waterDirectory}) {
  const water = waterDirectory.byId.get(view.route.id);
  if (!water) return nav.back();
  const original = view.route.parking;
  const shapes = water.mapped ? await waterDirectory.geography().catch(() => ({})) : {};
  const reference = waterPoint(water,shapes);
  const origin = original?.point || reference;
  let start;
  if (origin) {
    const [x,y] = mercator(origin);
    start = {x,y,level:15};
  } else start = await countryCamera(water.country);
  if (!view.active()) return;
  const title = t(original ? 'parking.edit' : 'parking.add');
  screen.innerHTML = back(water.name) + '<h1>'+esc(title)+'</h1><p>'+esc(water.name)+'</p><p>'+
    esc(t(origin ? 'parking.pick' : 'parking.pick_unlocated'))+'</p><div id="parking-map"></div>'+
    '<p id="parking-coordinates" role="status"></p>'+button('parking-geo',t('atlas_map.open'),'secondary','navigation')+
    '<label for="parking-name">'+esc(t('parking.name'))+'</label><input id="parking-name" maxlength="80">'+
    button('parking-confirm',t('parking.check'),'primary')+'<p id="parking-error" role="status"></p>';
  bindBack(nav);
  const input=by('parking-name'), save=by('parking-confirm'), geo=by('parking-geo');
  const id=original?.id || newJournalId().replace(/^(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})$/, '$1-$2-$3-$4-$5');
  input.value=original?.name || '';
  if (original?.label) input.placeholder=t(original.label);
  input.oninput=()=>{view.dirty=true;};
  function coordinates() {
    const selected=picker.point;
    by('parking-coordinates').textContent=selected ? selected[1].toFixed(6)+', '+selected[0].toFixed(6) : t('parking.no_selection');
    save.disabled=!selected;
    geo.hidden=!(selected || origin) || !window.Device?.navigate;
  }
  const picker={start,point:original?.point || null,onPick:()=>{view.dirty=true;coordinates();}};
  const map=atlasMap(by('parking-map'),{},null,picker);
  map.update([water],shapes,water.key);
  view.dispose=()=>map.dispose();
  coordinates();
  geo.onclick=()=>{const [lon,lat]=picker.point || origin; window.Device.navigate(lat,lon);};
  save.onclick=async()=>{
    if (!picker.point || view.saving) return;
    const [lon,lat]=picker.point, name=input.value.trim();
    const accepted=await confirmAction({title:t('parking.confirm_title'),
      message:[water.name,name || t(original?.label || 'parking.point'),lat.toFixed(6)+', '+lon.toFixed(6),t('parking.shared')].filter(Boolean).join(' · '),
      accept:t(original ? 'parking.save_edit' : 'parking.publish')});
    if (!accepted || !view.active()) return;
    await submitChange(view, async()=>{
      const result=await rpc('parking_save',{water_key:water.key,point_id:id,expected_revision:original?.revision || 0,lat,lon,title:name || null});
      if (result?.id!==id) throw Error('Unexpected parking response');
    },()=>{
      view.dirty=false;
      nav.back();
      toast(t('parking.saved'));
    },e=>{
      const message={403:'parking.owner_only',404:'parking.save_unavailable',409:'parking.conflict'}[e.status];
      by('parking-error').textContent=message ? t(message) : failure(e);
    });
  };
}
