// script.js — каждый маршрут хранит свой актив и восстанавливает его на загрузке

const map = L.map('map').setView([43.2140, 27.9147], 13);
const contextMenu = document.getElementById('contextMenu');
const routeContextMenu = document.getElementById('routeContextMenu');

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// Состояние
let routes = [];
let currentRouteIndex = null;
let currentContextMarker = null;
let activeSegments = {}; // { routeId: greenPolyline }

// UI-события
document.getElementById("newRouteBtn").addEventListener("click", createNewRoute);
document.getElementById("clearRoutesBtn").addEventListener("click", clearAllRoutes);
document.getElementById("resetProgressBtn").addEventListener("click", () => {
  // сброс прогресса у всех маршрутов
  routes.forEach(r => {
    r.activeIndex = null;
    // сброс стилей точек
    r.midMarkers.forEach(m => m.setStyle({ color: r.color, fillColor: '#fff' }));
    // убираем зелёный сегмент, если есть
    if (activeSegments[r.id]) {
      map.removeLayer(activeSegments[r.id]);
      delete activeSegments[r.id];
    }
  });
  saveRoutesToLocalStorage();
  updateRoutePath();
});
document.getElementById("speedInput").addEventListener("input", updateRoutePath);

// скрыть меню по клику вне его
document.addEventListener('click', e => {
  if (!contextMenu.contains(e.target)) hideContextMenu();
  if (!routeContextMenu.contains(e.target)) hideRouteContextMenu();
});

// — Контекстное меню для midpoint —
contextMenu.addEventListener('click', e => {
  if (!currentContextMarker) return;
  const route = routes.find(r => r.midMarkers.includes(currentContextMarker));
  if (!route) return;
  const idx = route.midMarkers.indexOf(currentContextMarker);
  const latlng = currentContextMarker.getLatLng();
  const action = e.target.dataset.action;

  if (action === 'activate') {
    // просто сохраняем активную точку у этого маршрута
    route.activeIndex = idx;
    currentRouteIndex = routes.indexOf(route);
    updateRouteList(); // подсветка в списке

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
    const p = interpolate(latlng, prev.getLatLng());
    route.midMarkers.splice(idx, 0, createMidpointMarker(p, route));
  } else if (action === 'add-after') {
    const next = route.midMarkers[idx + 1] || route.end;
    const p = interpolate(latlng, next.getLatLng());
    route.midMarkers.splice(idx + 1, 0, createMidpointMarker(p, route));
  } else if (action === 'rename') {
    renameMarker(currentContextMarker);
  }

  currentContextMarker = null;
  hideContextMenu();
  saveRoutesToLocalStorage();
  updateRoutePath();
});

// — Контекстное меню для маршрутов —
routeContextMenu.addEventListener('click', e => {
  if (currentRouteIndex === null) return;
  const action = e.target.dataset.action;
  const route = routes[currentRouteIndex];

  if (action === 'rename-route') {
    const name = prompt('Rename Route:', route.name);
    if (name) {
      route.name = name.trim();
      updateRouteList();
      saveRoutesToLocalStorage();
    }
  }
  if (action === 'delete-route') {
    // удаляем все слои маршрута
    [route.start, route.end, ...route.midMarkers].forEach(m => m && map.removeLayer(m));
    if (activeSegments[route.id]) {
      map.removeLayer(activeSegments[route.id]);
      delete activeSegments[route.id];
    }
    if (route.polyline) map.removeLayer(route.polyline);
    // удаляем из массива
    routes.splice(currentRouteIndex, 1);
    currentRouteIndex = routes.length ? 0 : null;
    updateRouteList();
    updateRoutePath();
    saveRoutesToLocalStorage();
  }

  hideRouteContextMenu();
});

// — Клик по карте: ставим start/end —
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
  saveRoutesToLocalStorage();
  updateRoutePath();
});

// === Фабрики ===

function createNewRoute() {
  const id = Date.now();
  const newRoute = {
    id,
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

function createMainMarker(latlng, label, route) {
  const m = L.marker(latlng, { draggable: true })
    .bindTooltip(label, { permanent: true, direction: 'top' })
    .on('drag', () => {
      createMidPoints(route);
      saveRoutesToLocalStorage();
      updateRoutePath();
    });
  if (route.visible) m.addTo(map);
  return m;
}

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

function createMidPoints(route) {
  route.midMarkers.forEach(m => map.removeLayer(m));
  route.midMarkers = [];
  if (!route.start || !route.end) return;
  interpolatePoints(route.start.getLatLng(), route.end.getLatLng())
    .forEach(p => route.midMarkers.push(createMidpointMarker(p, route)));
}

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

// === Отрисовка и информация ===

function updateRoutePath() {
  // сбросить все midpoint в исходный цвет
  routes.forEach(r => {
    r.midMarkers.forEach(m => m.setStyle({ color: r.color, fillColor: '#fff' }));
  });
  // удалить все старые зелёные сегменты
  Object.values(activeSegments).forEach(seg => map.removeLayer(seg));
  activeSegments = {};

  routes.forEach((r, idx) => {
    const pts = [];
    if (r.start) pts.push(r.start.getLatLng());
    pts.push(...r.midMarkers.map(m => m.getLatLng()));
    if (r.end) pts.push(r.end.getLatLng());

    // основная линия
    if (r.polyline) map.removeLayer(r.polyline);
    r.polyline = L.polyline(pts, { color: r.color, interactive: false });
    if (pts.length >= 2 && r.visible) r.polyline.addTo(map);

    // если у этого маршрута есть прогресс — рисуем
    if (r.activeIndex != null && r.visible) {
      const elapsed = [
        r.start.getLatLng(),
        ...r.midMarkers.slice(0, r.activeIndex + 1).map(m => m.getLatLng())
      ];
      const total = calculateDistance(pts);
      const elapsedDist = calculateDistance(elapsed);
      const rem = total - elapsedDist;

      activeSegments[r.id] = L.polyline(elapsed, {
        color: 'green', weight: 5, interactive: false
      }).addTo(map);

      r.midMarkers.slice(0, r.activeIndex + 1)
        .forEach(m => m.setStyle({ color: 'green', fillColor: 'lightgreen' }));

      if (idx === currentRouteIndex) {
        document.getElementById("routeName").textContent = `Route: ${r.name}`;
        document.getElementById("routeDistance")
          .textContent = `Total: ${total.toFixed(2)} km, Remaining: ${rem.toFixed(2)} km`;
        displayTimeBoth(elapsedDist, rem);
      }

    } else if (idx === currentRouteIndex) {
      const d = calculateDistance(pts);
      document.getElementById("routeName").textContent = `Route: ${r.name}`;
      document.getElementById("routeDistance")
        .textContent = `Distance: ${d.toFixed(2)} km`;
      displayRouteTime(d);
    }
  });
}

function calculateDistance(arr) {
  let sum = 0;
  for (let i = 1; i < arr.length; i++) {
    sum += map.distance(arr[i - 1], arr[i]);
  }
  return sum / 1000;
}

function displayRouteTime(km) {
  const sp = parseFloat(document.getElementById("speedInput").value);
  const out = document.getElementById("routeTime");
  if (!sp || sp <= 0) { out.textContent = "Travel Time: –"; return; }
  const hrs = km / sp, mins = Math.round(hrs * 60);
  const h = Math.floor(mins / 60), m = mins % 60;
  out.textContent = h ? `${h} hr ${m} min` : `${m} min`;
}

function displayTimeBoth(elapsedKm, remKm) {
  const sp = parseFloat(document.getElementById("speedInput").value);
  const out = document.getElementById("routeTime");
  if (!sp || sp <= 0) { out.textContent = "Travel Time: –"; return; }
  const eM = Math.round((elapsedKm/sp)*60), rM = Math.round((remKm/sp)*60);
  const eh = Math.floor(eM/60), em = eM%60;
  const rh = Math.floor(rM/60), rm = rM%60;
  out.innerHTML =
    `Elapsed: ${eh?`${eh}h ${em}m`:`${em}m`}<br>` +
    `Remaining: ${rh?`${rh}h ${rm}m`:`${rm}m`}`;
}

// === Помощники и меню ===

function enableCircleDragging(circle, route) {
  let drag = false;
  circle.on('mousedown', e => {
    if (e.originalEvent.button === 2) return;
    drag = true; map.dragging.disable();
  });
  map.on('mousemove', e => {
    if (drag) {
      circle.setLatLng(e.latlng);
      saveRoutesToLocalStorage();
      updateRoutePath();
    }
  });
  map.on('mouseup', () => {
    if (drag) { drag = false; map.dragging.enable(); }
  });
}

function updateRouteList() {
  const c = document.getElementById('routeList');
  c.innerHTML = '';
  routes.forEach((r, i) => {
    const div = document.createElement('div');
    div.className = 'route-item' + (i === currentRouteIndex ? ' active' : '');
    div.addEventListener('contextmenu', e => {
      e.preventDefault(); showRouteContextMenu(e, i);
    });

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = r.visible;
    cb.addEventListener('change', () => {
      r.visible = cb.checked;
      updateVisibility(r);
      saveRoutesToLocalStorage();
      updateRoutePath();
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

function showRouteContextMenu(e, idx) {
  currentRouteIndex = idx;
  routeContextMenu.style.left = `${e.pageX}px`;
  routeContextMenu.style.top  = `${e.pageY}px`;
  routeContextMenu.style.display = 'block';
}
function hideRouteContextMenu() {
  routeContextMenu.style.display = 'none';
}

function updateVisibility(route) {
  // если скрываем — убрать зелёный сегмент
  if (!route.visible && activeSegments[route.id]) {
    map.removeLayer(activeSegments[route.id]);
    delete activeSegments[route.id];
  }
  // прячем/показываем все маркеры
  [route.start, route.end, ...route.midMarkers].forEach(m => {
    if (!m) return;
    route.visible ? m.addTo(map) : map.removeLayer(m);
  });
  // прячем/показываем основную линию
  if (route.polyline) {
    route.visible ? route.polyline.addTo(map) : map.removeLayer(route.polyline);
  }
}

function clearAllRoutes() {
  routes.forEach(r => {
    [r.start, r.end, ...r.midMarkers].forEach(m => m && map.removeLayer(m));
    if (r.polyline) map.removeLayer(r.polyline);
    if (activeSegments[r.id]) map.removeLayer(activeSegments[r.id]);
  });
  routes = [];
  currentRouteIndex = null;
  activeSegments = {};
  localStorage.removeItem('routes');
  updateRouteList();
}

function renameMarker(marker) {
  const name = prompt('Enter new name:', marker.options.name || '');
  if (name) {
    marker.options.name = name.trim();
    marker.bindTooltip(marker.options.name, { permanent:false, direction:'top' });
    saveRoutesToLocalStorage();
  }
}

function interpolate(p1, p2) {
  return L.latLng((p1.lat + p2.lat)/2, (p1.lng + p2.lng)/2);
}

function getRandomColor() {
  const hex = '0123456789ABCDEF';
  return '#' + Array.from({length:6}, () =>
    hex[Math.floor(Math.random()*16)]
  ).join('');
}

function saveRoutesToLocalStorage() {
  const data = routes.map(r => ({
    id: r.id,
    name: r.name,
    visible: r.visible,
    color: r.color,
    start: r.start ? r.start.getLatLng() : null,
    end:   r.end   ? r.end.getLatLng()   : null,
    mid:   r.midMarkers.map(m => ({ ...m.getLatLng(), name: m.options.name||'' })),
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
  // сразу применить флаг visible и убрать лишние сегменты
  routes.forEach(r => updateVisibility(r));
  // выбрать маршрут с прогрессом или первый
  if (routes.length) {
    const idx = routes.findIndex(r => r.activeIndex != null);
    currentRouteIndex = idx >= 0 ? idx : 0;
  }
  updateRouteList();
  updateRoutePath();
}

loadRoutesFromLocalStorage();
