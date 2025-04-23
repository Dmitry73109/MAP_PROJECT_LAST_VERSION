// script.js — full version with progress, rename/delete, save/load,
// plus remaining distance/time calculation on “Activate Here”

const map = L.map('map').setView([43.2140, 27.9147], 13);
const contextMenu = document.getElementById('contextMenu');
const routeContextMenu = document.getElementById('routeContextMenu');

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let routes = [];
let currentRouteIndex = null;
let currentContextMarker = null;
let activeSegment = null;   // green progress line

// UI event bindings
document.getElementById("newRouteBtn")
  .addEventListener("click", createNewRoute);
document.getElementById("clearRoutesBtn")
  .addEventListener("click", clearAllRoutes);
document.getElementById("resetProgressBtn")
  .addEventListener("click", () => {
    // clear all progress
    routes.forEach(r => {
      r.midMarkers.forEach(m =>
        m.setStyle({ color: r.color, fillColor: '#fff' })
      );
      r.activeIndex = null;
    });
    if (activeSegment) {
      map.removeLayer(activeSegment);
      activeSegment = null;
    }
    saveRoutesToLocalStorage();
    updateRoutePath();
  });
document.getElementById("speedInput")
  .addEventListener("input", updateRoutePath);

// hide menus on outside click
document.addEventListener('click', e => {
  if (!contextMenu.contains(e.target)) hideContextMenu();
  if (!routeContextMenu.contains(e.target)) hideRouteContextMenu();
});

// — Marker (point) context menu —
// includes "activate", add/delete/rename
contextMenu.addEventListener('click', e => {
  if (!currentContextMarker) return;
  const route = routes.find(r => r.midMarkers.includes(currentContextMarker));
  if (!route) return;
  const idx = route.midMarkers.indexOf(currentContextMarker);
  const latlng = currentContextMarker.getLatLng();
  const action = e.target.dataset.action;

  if (action === 'activate') {
    // save progress index
    route.activeIndex = idx;

    // clear old green line
    if (activeSegment) {
      map.removeLayer(activeSegment);
      activeSegment = null;
    }
    // reset all midpoint styles
    route.midMarkers.forEach(m =>
      m.setStyle({ color: route.color, fillColor: '#fff' })
    );
    // coords from start to chosen marker
    const elapsedCoords = [
      route.start.getLatLng(),
      ...route.midMarkers.slice(0, idx + 1).map(m => m.getLatLng())
    ];
    // draw green line
    activeSegment = L.polyline(elapsedCoords, {
      color: 'green', weight: 5, interactive: false
    }).addTo(map);
    // color visited points green
    route.midMarkers.slice(0, idx + 1)
      .forEach(m => m.setStyle({ color: 'green', fillColor: 'lightgreen' }));

    hideContextMenu();
    saveRoutesToLocalStorage();
    updateRoutePath();
    return;
  }

  if (action === 'delete') {
    map.removeLayer(currentContextMarker);
    route.midMarkers.splice(idx, 1);
  } else if (action === 'add-before') {
    const prev = route.midMarkers[idx - 1] || route.start;
    if (prev) {
      const p = interpolate(latlng, prev.getLatLng());
      route.midMarkers.splice(idx, 0, createMidpointMarker(p, route));
    }
  } else if (action === 'add-after') {
    const next = route.midMarkers[idx + 1] || route.end;
    if (next) {
      const p = interpolate(latlng, next.getLatLng());
      route.midMarkers.splice(idx + 1, 0, createMidpointMarker(p, route));
    }
  } else if (action === 'rename') {
    renameMarker(currentContextMarker);
  }

  currentContextMarker = null;
  hideContextMenu();
  updateRoutePath();
  saveRoutesToLocalStorage();
});

// — Route context menu —
// rename or delete entire route
routeContextMenu.addEventListener('click', e => {
  const action = e.target.dataset.action;
  if (currentRouteIndex === null) return;

  if (action === 'rename-route') {
    const name = prompt('Rename Route:', routes[currentRouteIndex].name);
    if (name && name.trim()) {
      routes[currentRouteIndex].name = name.trim();
      updateRouteList();
      saveRoutesToLocalStorage();
    }
  }
  else if (action === 'delete-route') {
    const r = routes[currentRouteIndex];
    [r.start, r.end].forEach(m => m && map.removeLayer(m));
    r.midMarkers.forEach(m => map.removeLayer(m));
    if (r.polyline) map.removeLayer(r.polyline);
    routes.splice(currentRouteIndex, 1);
    currentRouteIndex = routes.length ? 0 : null;
    updateRouteList();
    updateRoutePath();
    saveRoutesToLocalStorage();
  }

  hideRouteContextMenu();
});

// map click → place start/end markers
map.on('click', e => {
  const el = e.originalEvent.target;
  if (
    el.closest('#controls') ||
    el.closest('#contextMenu') ||
    el.closest('#routeContextMenu') ||
    el.classList.contains('leaflet-marker-icon') ||
    el.classList.contains('leaflet-interactive')
  ) return;
  if (currentRouteIndex === null) return;
  const route = routes[currentRouteIndex];
  if (!route.visible) return;

  const latlng = e.latlng;
  if (!route.start) {
    route.start = createMainMarker(latlng, 'Start', route);
  } else if (!route.end) {
    route.end = createMainMarker(latlng, 'End', route);
    createMidPoints(route);
  }
  updateRoutePath();
  saveRoutesToLocalStorage();
});

// — Factory functions —
// Create new empty route
function createNewRoute() {
  const newRoute = {
    id: Date.now(),
    name: `Route ${routes.length + 1}`,
    start: null,
    end: null,
    midMarkers: [],
    polyline: null,
    visible: true,
    color: getRandomColor(),
    activeIndex: null
  };
  routes.push(newRoute);
  currentRouteIndex = routes.length - 1;
  updateRouteList();
  saveRoutesToLocalStorage();
}

// Create draggable start/end marker
function createMainMarker(latlng, label, route) {
  const m = L.marker(latlng, { draggable: true })
    .bindTooltip(label, { permanent: true, direction: 'top' })
    .on('drag', () => {
      createMidPoints(route);
      updateRoutePath();
      saveRoutesToLocalStorage();
    });
  if (route.visible) m.addTo(map);
  return m;
}

// Create draggable midpoint
function createMidpointMarker(latlng, route) {
  const c = L.circleMarker(latlng, {
    radius: 8, color: route.color,
    fillColor: '#fff', fillOpacity: 1, weight: 2
  }).bindTooltip('Point', { direction: 'top' });

  enableCircleDragging(c, route);
  c.on('contextmenu', e => {
    e.originalEvent.preventDefault();
    showContextMenu(e, c);
  });
  if (route.visible) c.addTo(map);
  return c;
}

// Recompute midpoints between start and end
function createMidPoints(route) {
  route.midMarkers.forEach(m => map.removeLayer(m));
  route.midMarkers = [];
  if (!route.start || !route.end) return;
  interpolatePoints(route.start.getLatLng(), route.end.getLatLng())
    .forEach(p => route.midMarkers.push(createMidpointMarker(p, route)));
}

// Evenly split segment into points
function interpolatePoints(start, end) {
  const d = map.distance(start, end);
  const cnt = Math.min(20, Math.max(1, Math.floor(d / 300)));
  const pts = [];
  for (let i = 1; i <= cnt; i++) {
    const f = i / (cnt + 1);
    pts.push(L.latLng(
      start.lat + (end.lat - start.lat) * f,
      start.lng + (end.lng - start.lng) * f
    ));
  }
  return pts;
}

// ====================== Rendering & Info ======================

// Redraw all routes, apply progress and compute remaining
function updateRoutePath() {
  if (activeSegment) {
    map.removeLayer(activeSegment);
    activeSegment = null;
  }

  routes.forEach((r, idx) => {
    const pts = [];
    if (r.start) pts.push(r.start.getLatLng());
    pts.push(...r.midMarkers.map(m => m.getLatLng()));
    if (r.end) pts.push(r.end.getLatLng());

    if (r.polyline) map.removeLayer(r.polyline);
    r.polyline = L.polyline(pts, { color: r.color, interactive: false });
    if (pts.length >= 2 && r.visible) r.polyline.addTo(map);

    if (idx === currentRouteIndex) {
      const totalDist = calculateDistance(pts);

      // If progress is set, compute elapsed & remaining
      if (r.activeIndex != null) {
        // Elapsed points
        const elapsedPts = [
          r.start.getLatLng(),
          ...r.midMarkers.slice(0, r.activeIndex + 1).map(m => m.getLatLng())
        ];
        const elapsedDist = calculateDistance(elapsedPts);
        const remDist = totalDist - elapsedDist;

        // Re-draw green segment
        activeSegment = L.polyline(elapsedPts, {
          color: 'green', weight: 5, interactive: false
        }).addTo(map);
        // Style visited points
        r.midMarkers.slice(0, r.activeIndex + 1)
          .forEach(m => m.setStyle({ color: 'green', fillColor: 'lightgreen' }));

        // Update info panel: total vs remaining
        document.getElementById("routeName").textContent = `Route: ${r.name}`;
        document.getElementById("routeDistance")
          .textContent = `Total: ${totalDist.toFixed(2)} km, Remaining: ${remDist.toFixed(2)} km`;
        displayTimeBoth(elapsedDist, remDist);
      } else {
        // No progress: show only total
        document.getElementById("routeName").textContent = `Route: ${r.name}`;
        document.getElementById("routeDistance")
          .textContent = `Distance: ${totalDist.toFixed(2)} km`;
        displayRouteTime(totalDist);
      }
    }
  });
}

// Sum distances in km
function calculateDistance(arr) {
  let sum = 0;
  for (let i = 1; i < arr.length; i++) {
    sum += map.distance(arr[i - 1], arr[i]);
  }
  return sum / 1000;
}

// Display only total time
function displayRouteTime(km) {
  const sp = parseFloat(document.getElementById("speedInput").value);
  const out = document.getElementById("routeTime");
  if (!sp || sp <= 0) {
    out.textContent = "Travel Time: –";
    return;
  }
  const hrs = km / sp;
  const mins = Math.round(hrs * 60);
  const h = Math.floor(mins / 60), m = mins % 60;
  out.textContent = h > 0 ? `${h} hr ${m} min` : `${m} min`;
}

// Display elapsed & remaining time
function displayTimeBoth(elapsedKm, remainingKm) {
  const sp = parseFloat(document.getElementById("speedInput").value);
  const out = document.getElementById("routeTime");
  if (!sp || sp <= 0) {
    out.textContent = "Travel Time: –";
    return;
  }
  const elapsedH = elapsedKm / sp;
  const remH = remainingKm / sp;
  const elapsedMins = Math.round(elapsedH * 60);
  const remMins = Math.round(remH * 60);
  const eh = Math.floor(elapsedMins / 60), em = elapsedMins % 60;
  const rh = Math.floor(remMins / 60), rm = remMins % 60;
  out.innerHTML =
    `Elapsed: ${eh>0?`${eh}h ${em}m`:`${em}m`}<br>` +
    `Remaining: ${rh>0?`${rh}h ${rm}m`:`${rm}m`}`;
}

// ====================== Helpers & Context Menus ======================
// — Drag helper for midpoints —
function enableCircleDragging(circle, route) {
  let drag = false;
  circle.on('mousedown', e => {
    if (e.originalEvent.button === 2) return;
    drag = true; map.dragging.disable();
  });
  map.on('mousemove', e => {
    if (drag) {
      circle.setLatLng(e.latlng);
      updateRoutePath();
    }
  });
  map.on('mouseup', () => {
    if (drag) {
      drag = false; map.dragging.enable();
      saveRoutesToLocalStorage();
    }
  });
}

// — Sidebar & Context menus —
function updateRouteList() {
  const c = document.getElementById('routeList');
  c.innerHTML = '';
  routes.forEach((r, i) => {
    const div = document.createElement('div');
    div.className = 'route-item' + (i === currentRouteIndex ? ' active' : '');
    div.addEventListener('contextmenu', e => {
      e.preventDefault();
      showRouteContextMenu(e, i);
    });

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = r.visible;
    cb.addEventListener('change', () => {
      r.visible = cb.checked;
      updateVisibility(r);
      saveRoutesToLocalStorage();
    });

    const lbl = document.createElement('label');
    lbl.textContent = r.name;
    lbl.addEventListener('click', () => {
      currentRouteIndex = i;
      updateRouteList();
      updateRoutePath();
    });

    div.appendChild(cb);
    div.appendChild(lbl);
    c.appendChild(div);
  });
}

function updateVisibility(route) {
  [route.start, route.end, ...route.midMarkers].forEach(m => {
    if (!m) return;
    route.visible ? m.addTo(map) : map.removeLayer(m);
  });
  if (route.polyline) {
    route.visible ? route.polyline.addTo(map) : map.removeLayer(route.polyline);
  }
}

function showContextMenu(e, marker) {
  currentContextMarker = marker;
  contextMenu.style.left = `${e.originalEvent.pageX}px`;
  contextMenu.style.top  = `${e.originalEvent.pageY}px`;
  contextMenu.style.display = 'block';
}
function hideContextMenu() {
  contextMenu.style.display = 'none';
  currentContextMarker = null;
}

function showRouteContextMenu(e, index) {
  currentRouteIndex = index;
  routeContextMenu.style.left = `${e.pageX}px`;
  routeContextMenu.style.top  = `${e.pageY}px`;
  routeContextMenu.style.display = 'block';
}
function hideRouteContextMenu() {
  routeContextMenu.style.display = 'none';
}

function interpolate(p1, p2) {
  return L.latLng(
    (p1.lat + p2.lat) / 2,
    (p1.lng + p2.lng) / 2
  );
}

function renameMarker(marker) {
  const name = prompt('Enter new name:', marker.options.name || '');
  if (name && name.trim()) {
    marker.options.name = name.trim();
    marker.bindTooltip(name, { permanent:false, direction:'top' });
  }
}

function getRandomColor() {
  const hex = '0123456789ABCDEF';
  return '#' + Array.from({length:6}, () =>
    hex[Math.floor(Math.random() * 16)]
  ).join('');
}

function clearAllRoutes() {
  routes.forEach(r => {
    [r.start, r.end].forEach(m => m && map.removeLayer(m));
    r.midMarkers.forEach(m => map.removeLayer(m));
    if (r.polyline) map.removeLayer(r.polyline);
  });
  routes = [];
  currentRouteIndex = null;
  localStorage.removeItem('routes');
  updateRouteList();
}

function saveRoutesToLocalStorage() {
  const data = routes.map(r => ({
    id: r.id,
    name: r.name,
    visible: r.visible,
    color: r.color,
    start: r.start ? r.start.getLatLng() : null,
    end:   r.end   ? r.end.getLatLng()   : null,
    mid:   r.midMarkers.map(m => ({ ...m.getLatLng(), name: m.options.name || '' })),
    activeIndex: r.activeIndex
  }));
  localStorage.setItem('routes', JSON.stringify(data));
}

function loadRoutesFromLocalStorage() {
  const saved = JSON.parse(localStorage.getItem('routes'));
  if (!saved) return;
  routes = saved.map(r => {
    const obj = {
      id: r.id,
      name: r.name,
      start: null,
      end: null,
      midMarkers: [],
      polyline: null,
      visible: r.visible,
      color: r.color,
      activeIndex: r.activeIndex
    };
    if (r.start) obj.start = createMainMarker(r.start, 'Start', obj);
    if (r.end)   obj.end   = createMainMarker(r.end,   'End',   obj);
    obj.midMarkers = r.mid.map(p => {
      const m = createMidpointMarker(p, obj);
      if (p.name) m.bindTooltip(p.name, { permanent:false, direction:'top' });
      return m;
    });
    if (obj.start && obj.end && obj.midMarkers.length === 0) {
      createMidPoints(obj);
    }
    return obj;
  });

  // pick first with progress or default
  if (routes.length > 0) {
    const idx = routes.findIndex(r => r.activeIndex != null);
    currentRouteIndex = idx !== -1 ? idx : 0;
  }
  updateRouteList();
  updateRoutePath();
}

loadRoutesFromLocalStorage();
