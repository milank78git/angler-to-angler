import { by, button, esc, t } from './ui.js';

// Use a documented point on each water; some records only have a published outline.
export function waterPoint(water, shapes) {
  return [water.access?.pt, water.points?.[0], water.bounds?.[0], water.lines?.[0]?.[0],
    shapes[water.key]?.[0]?.[0]?.[0]].find(p => Array.isArray(p) && p.length === 2 &&
      p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90);
}

export function clusterWaters(rows, project, width, height) {
  const cells = new Map();
  for (const row of rows) {
    const [x,y] = project(row.point);
    if (x<0 || x>width || y<0 || y>height) continue;
    const key = Math.floor(x/44) + '/' + Math.floor(y/44);
    const group = cells.get(key) || {x:0,y:0,waters:[]};
    group.x+=x; group.y+=y; group.waters.push(row);
    cells.set(key,group);
  }
  return Array.from(cells.values());
}

/** Keep camera and selection in the route so Back returns to the same area. */
export function atlasMap(host, route, openWater) {
  host.innerHTML = '<div class="actions">'+button('zoom-in',t('atlas.zoom_in'),'secondary')+
    button('zoom-out',t('atlas.zoom_out'),'secondary')+button('map-fit',t('atlas.fit'),'secondary')+
    '</div><svg id="world-map" role="group" tabindex="0" aria-label="'+esc(t('atlas.map'))+'"></svg>'+
    '<p id="map-count" role="status"></p><div id="map-selection" class="water-list"></div>';
  const svg=by('world-map'), selected=by('map-selection');
  let rows=[], missing=0, camera=route.camera, groups=[], index=0, down;
  const pointers=new Map();
  const width=()=>svg.clientWidth || 320, height=()=>svg.clientHeight || 300;
  const unit=()=>Math.min(width()/360,height()/180)*camera.zoom;
  function zoom(value, x=width()/2,y=height()/2) {
    const before=unit();
    camera.zoom=Math.min(65536,Math.max(1,value));
    camera.lon+=(x-width()/2)*(1/before-1/unit());
    camera.lat-=(y-height()/2)*(1/before-1/unit());
    draw();
  }
  function fit() {
    let left=180,right=-180,bottom=90,top=-90;
    for(const {point:[x,y]} of rows) {
      left=Math.min(left,x);right=Math.max(right,x);bottom=Math.min(bottom,y);top=Math.max(top,y);
    }
    camera=route.camera=rows.length ? {lon:(right+left)/2,lat:(top+bottom)/2,
      zoom:Math.min(65536,Math.max(1,.82*Math.min(width()/Math.max(.01,right-left),height()/Math.max(.01,top-bottom))/Math.min(width()/360,height()/180)))} :
      {lon:0,lat:0,zoom:1};
    draw();
  }
  function draw() {
    if(!camera || host.hidden) return;
    camera.lon=Math.min(180,Math.max(-180,camera.lon)); camera.lat=Math.min(90,Math.max(-90,camera.lat));
    const w=width(),h=height(),s=unit(),project=([lon,lat])=>[w/2+(lon-camera.lon)*s,h/2-(lat-camera.lat)*s];
    const [x,y]=project([-180,90]);groups=clusterWaters(rows,project,w,h);
    svg.setAttribute('viewBox',[0,0,w,h].join(' '));
    svg.innerHTML='<image href="world-land.svg" x="'+x+'" y="'+y+'" width="'+360*s+'" height="'+180*s+'"/>'+
      groups.map((g,i)=>{const n=g.waters.length;const label=n===1 ? g.waters[0].water.name : t('waters.waters')+' · '+n;
        return '<g role="button" tabindex="0" aria-label="'+esc(label)+'" data-group="'+i+'" transform="translate('+g.x/n+' '+g.y/n+')"><circle r="17"/><text y="4">'+(n===1?'•':n)+'</text></g>';
      }).join('');
    by('zoom-out').disabled=camera.zoom<=1;by('zoom-in').disabled=camera.zoom>=65536;
    by('map-count').textContent=t('atlas.mapped')+' · '+rows.length+' / '+(rows.length+missing)
      + (route.parkingOnly && !rows.length && !missing ? ' · '+t('parking.filter_empty') : '');
  }
  function pick(target) {
    const el=target.closest('[data-group]');if(!el)return;
    const group=groups[Number(el.dataset.group)];if(!group)return;
    if(group.waters.length===1) return openWater(group.waters[0].water.id);
    // Even exactly co-located venues remain individually selectable.
    const choices=group.waters;index=0;selected.replaceChildren();
    function more() {
      for(const {water} of choices.slice(index,index+40)) {
        const b=document.createElement('button'); b.type='button';b.className='secondary';
        b.textContent=[water.name,water.number,water.country].filter(Boolean).join(' · ');
        b.onclick=()=>openWater(water.id);selected.append(b);
      }
      index+=40;
      if(index<choices.length){const b=document.createElement('button');b.textContent=t('waters.show_more_waters');b.onclick=()=>{b.remove();more();};selected.append(b);}
    }
    more();zoom(camera.zoom*2,group.x/choices.length,group.y/choices.length);
  }
  svg.onkeydown=e=>{
    if(e.key==='Enter' || e.key===' '){e.preventDefault();pick(e.target);return;}
    const offset={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]}[e.key];
    if(offset){e.preventDefault();camera.lon+=offset[0]*65/unit();camera.lat+=offset[1]*65/unit();draw();}
  };
  svg.onclick=e=>{if(!down?.moved)pick(e.target);};
  svg.onpointerdown=e=>{pointers.set(e.pointerId,[e.clientX,e.clientY]);down={x:e.clientX,y:e.clientY,moved:pointers.size>1};};
  svg.onpointermove=e=>{
    const prev=pointers.get(e.pointerId);if(!prev||!down)return;
    const now=[e.clientX,e.clientY],other=[...pointers].find(([id])=>id!==e.pointerId)?.[1];
    if(!down.moved && Math.hypot(now[0]-down.x,now[1]-down.y)<5)return;
    down.moved=true;svg.setPointerCapture(e.pointerId);pointers.set(e.pointerId,now);
    if(other){const old=Math.hypot(prev[0]-other[0],prev[1]-other[1]),gap=Math.hypot(now[0]-other[0],now[1]-other[1]);
      if(old && gap){const r=svg.getBoundingClientRect();zoom(camera.zoom*gap/old,(now[0]+other[0])/2-r.left,(now[1]+other[1])/2-r.top);} }
    else{camera.lon-=(now[0]-prev[0])/unit();camera.lat+=(now[1]-prev[1])/unit();draw();}
  };
  svg.onpointercancel=svg.onpointerup=e=>pointers.delete(e.pointerId);
  svg.onpointerleave=e=>{if(!svg.hasPointerCapture(e.pointerId))pointers.delete(e.pointerId);};
  svg.onwheel=e=>{e.preventDefault();const r=svg.getBoundingClientRect();zoom(camera.zoom*(e.deltaY<0?1.5:1/1.5),e.clientX-r.left,e.clientY-r.top);};
  by('zoom-in').onclick=()=>zoom(camera.zoom*2);by('zoom-out').onclick=()=>zoom(camera.zoom/2);by('map-fit').onclick=fit;
  const observer=new ResizeObserver(draw);observer.observe(svg);
  return {update(waters,shapes,key){
    rows=waters.map(water=>({water,point:waterPoint(water,shapes)})).filter(row=>row.point);
    missing=waters.length-rows.length;selected.replaceChildren();
    if (!camera || route.cameraFilter !== key) fit();
    else draw();
    route.cameraFilter = key;
  },dispose(){observer.disconnect();}};
}
