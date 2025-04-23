const map = L.map('map').setView([43.2140, 27.9147], 13);
const contextMenu = document.getElementById('contextMenu');

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// Store all routes here; each route holds its markers, polyline, etc.
let routes = [];
// Index of the route currently selected in the sidebar
let currentRouteIndex = null;
// The marker that was right-clicked to open the context menu
let currentContextMarker = null;

/* ─────────────── UI EVENT LISTENERS ─────────────── */

// Create a brand-new route object when user clicks "New Route"
document.getElementById("newRouteBtn")
  .addEventListener("click", createNewRoute);

// Remove all routes and clear storage on "Delete All Routes"
document.getElementById("clearRoutesBtn")
  .addEventListener("click", clearAllRoutes);

// When the speed input changes, recalc distance & time for active route
document.getElementById("speedInput")
  .addEventListener("input", updateRoutePath);

// Click anywhere outside context menu hides it
document.addEventListener('click', e => {
  if (!contextMenu.contains(e.target)) hideContextMenu();
});

// Handle clicks on the context menu items (delete/add/rename)
contextMenu.addEventListener('click', e => {
  if (!currentContextMarker) return;  // no marker selected?

  // Find which route this marker belongs to
  const route = routes.find(r => r.midMarkers.includes(currentContextMarker));
  if (!route) return;

  const idx = route.midMarkers.indexOf(currentContextMarker);
  const latlng = currentContextMarker.getLatLng();

  // Delete this midpoint
  if (e.target.dataset.action === 'delete') {
    map.removeLayer(currentContextMarker);
    route.midMarkers.splice(idx, 1);

  // Add a new point before this one
  } else if (e.target.dataset.action === 'add-before') {
    const prev = route.midMarkers[idx - 1] || route.start;
    if (prev) {
      const newLatLng = interpolate(latlng, prev.getLatLng());
      const m = createMidpointMarker(newLatLng, route);
      route.midMarkers.splice(idx, 0, m);
    }

  // Add a new point after this one
  } else if (e.target.dataset.action === 'add-after') {
    const next = route.midMarkers[idx + 1] || route.end;
    if (next) {
      const newLatLng = interpolate(latlng, next.getLatLng());
      const m = createMidpointMarker(newLatLng, route);
      route.midMarkers.splice(idx + 1, 0, m);
    }

  // Rename this point
  } else if (e.target.dataset.action === 'rename') {
    renameMarker(currentContextMarker);
  }

  // Close menu and refresh path/storage
  currentContextMarker = null;
  hideContextMenu();
  updateRoutePath();
  saveRoutesToLocalStorage();
});


/* ─────────────── ROUTE MANAGEMENT ─────────────── */

// Create a fresh route object with default values
function createNewRoute() {
  const newRoute = {
    id: Date.now(),               // unique timestamp ID
    name: `Route ${routes.length + 1}`, 
    start: null,                  // will hold start marker
    end: null,                    // will hold end marker
    midMarkers: [],               // array of intermediate circleMarkers
    polyline: null,               // Leaflet polyline connecting points
    visible: true,                // toggles map display
    color: getRandomColor()       // random hex color for route
  };
  routes.push(newRoute);
  currentRouteIndex = routes.length - 1; // select the newly created route
  updateRouteList();                      // refresh sidebar
  saveRoutesToLocalStorage();             // persist change
}


/* ─────────────── MAP CLICK HANDLING ─────────────── */

// Listen for clicks on the map to place start/end markers
map.on('click', e => {
  const el = e.originalEvent.target;

  // Ignore clicks on UI panels, context menu, markers, or lines
  if (
    el.closest('#controls')    ||
    el.closest('#contextMenu') ||
    el.classList.contains('leaflet-marker-icon') ||
    el.classList.contains('leaflet-interactive')
  ) return;

  // Must have a selected route
  if (currentRouteIndex === null) return;
  const route = routes[currentRouteIndex];

  // Skip if route is hidden via the checkbox
  if (!route.visible) return;

  const latlng = e.latlng;

  // First click sets the start point
  if (!route.start) {
    route.start = createMainMarker(latlng, 'Start', route);

  // Second click sets the end point and triggers midpoint creation
  } else if (!route.end) {
    route.end = createMainMarker(latlng, 'End', route);
    createMidPoints(route);
  }

  updateRoutePath();            // draw/update polyline
  saveRoutesToLocalStorage();   // persist new markers
});


/* ─────────────── MARKER CREATORS ─────────────── */

// Create start/end marker with tooltip and drag behavior
function createMainMarker(latlng, label, route) {
  const marker = L.marker(latlng, { draggable: true });
  marker.bindTooltip(label, { permanent: true, direction: 'top' });

  // When dragged, re-create mids and re-draw path
  marker.on('drag', () => {
    createMidPoints(route);
    updateRoutePath();
    saveRoutesToLocalStorage();
  });

  if (route.visible) marker.addTo(map);
  return marker;
}

// Create a draggable circleMarker for midpoints
function createMidpointMarker(latlng, route) {
  const circle = L.circleMarker(latlng, {
    radius: 8,
    color: route.color,
    fillColor: '#fff',
    fillOpacity: 1,
    weight: 2
  });
  circle.bindTooltip('Point', { permanent: false, direction: 'top' });

  enableCircleDragging(circle, route);

  // Open our custom context menu on right-click
  circle.on('contextmenu', e => {
    e.originalEvent.preventDefault();
    showContextMenu(e, circle);
  });

  if (route.visible) circle.addTo(map);
  return circle;
}


/* ─────────────── MIDPOINT LOGIC ─────────────── */

// Remove old mids and generate new evenly-spaced ones
function createMidPoints(route) {
  route.midMarkers.forEach(m => map.removeLayer(m));
  route.midMarkers = [];

  if (!route.start || !route.end) return;

  const pts = interpolatePoints(
    route.start.getLatLng(),
    route.end.getLatLng()
  );

  pts.forEach(p => {
    const m = createMidpointMarker(p, route);
    route.midMarkers.push(m);
  });
}

// Split the line into equal segments under maxDist (meters)
function interpolatePoints(start, end) {
  const distance = map.distance(start, end);
  const maxDist = 300;
  const count = Math.min(20, Math.max(1, Math.floor(distance / maxDist)));

  const points = [];
  for (let i = 1; i <= count; i++) {
    const frac = i / (count + 1);
    const lat = start.lat + (end.lat - start.lat) * frac;
    const lng = start.lng + (end.lng - start.lng) * frac;
    points.push(L.latLng(lat, lng));
  }
  return points;
}


/* ─────────────── DRAW & UPDATE PATH ─────────────── */

// Redraw all polylines and update info panel for the active route
function updateRoutePath() {
  routes.forEach((route, idx) => {
    // Gather all coordinates in sequence
    const coords = [];
    if (route.start) coords.push(route.start.getLatLng());
    coords.push(...route.midMarkers.map(m => m.getLatLng()));
    if (route.end) coords.push(route.end.getLatLng());

    // Remove previous polyline if exists
    if (route.polyline) map.removeLayer(route.polyline);

    // Create new polyline (non-interactive so it won't block markers)
    route.polyline = L.polyline(coords, {
      color: route.color,
      interactive: false
    });

    // Only draw on map if route is visible and has at least 2 points
    if (coords.length >= 2 && route.visible) {
      route.polyline.addTo(map);
    }

    // If this is the currently selected route, update stats UI
    if (idx === currentRouteIndex) {
      const dist = calculateDistance(coords);
      document.getElementById("routeName").textContent = `Route: ${route.name}`;
      document.getElementById("routeDistance")
        .textContent = `Distance: ${dist.toFixed(2)} km`;
      displayRouteTime(dist);
    }
  });
}

// Sum up distances between consecutive points
function calculateDistance(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += map.distance(coords[i-1], coords[i]);
  }
  return total / 1000; // convert meters to kilometers
}

// Show travel time based on distance and speed input
function displayRouteTime(distanceKm) {
  const speed = parseFloat(document.getElementById("speedInput").value);
  const out = document.getElementById("routeTime");

  if (!speed || speed <= 0) {
    out.textContent = "Travel Time: –";
    return;
  }

  const hours = distanceKm / speed;
  const minutesTotal = Math.round(hours * 60);
  const h = Math.floor(minutesTotal / 60);
  const m = minutesTotal % 60;
  const str = h > 0 ? `${h} hr ${m} min` : `${m} min`;

  out.textContent = `Travel Time: ${str}`;
}


/* ─────────────── DRAG HANDLER FOR CIRCLES ─────────────── */

// Custom dragging so circleMarker is movable without map panning
function enableCircleDragging(circle, route) {
  let dragging = false;

  circle.on('mousedown', e => {
    if (e.originalEvent.button === 2) return; // ignore right-click
    dragging = true;
    map.dragging.disable(); // stop map from moving
  });

  map.on('mousemove', e => {
    if (dragging) {
      circle.setLatLng(e.latlng); // move circle
      updateRoutePath();          // redraw line
    }
  });

  map.on('mouseup', () => {
    if (dragging) {
      dragging = false;
      map.dragging.enable();
      saveRoutesToLocalStorage(); // save new pos
    }
  });
}


/* ─────────────── SIDEBAR & VISIBILITY ─────────────── */

// Rebuild the sidebar list; add 'active' class to selected route
function updateRouteList() {
  const list = document.getElementById('routeList');
  list.innerHTML = ''; // clear old entries

  routes.forEach((route, idx) => {
    const item = document.createElement('div');
    item.className = 'route-item' + (idx === currentRouteIndex ? ' active' : '');

    // Checkbox to toggle map visibility
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = route.visible;
    cb.addEventListener('change', () => {
      route.visible = cb.checked;
      updateVisibility(route);
      saveRoutesToLocalStorage();
    });

    // Click label to select this route
    const label = document.createElement('label');
    label.textContent = route.name;
    label.addEventListener('click', () => {
      currentRouteIndex = idx;
      updateRouteList();
      updateRoutePath();
    });

    item.appendChild(cb);
    item.appendChild(label);
    list.appendChild(item);
  });
}

// Show or hide all markers and line for a route
function updateVisibility(route) {
  const all = [route.start, route.end, ...route.midMarkers];
  all.forEach(m => {
    if (m) {
      route.visible ? m.addTo(map) : map.removeLayer(m);
    }
  });
  if (route.polyline) {
    route.visible ? route.polyline.addTo(map)
                  : map.removeLayer(route.polyline);
  }
}


/* ─────────────── CONTEXT MENU HELPERS ─────────────── */

// Position and show our HTML context menu
function showContextMenu(e, marker) {
  currentContextMarker = marker;
  contextMenu.style.left = e.originalEvent.pageX + 'px';
  contextMenu.style.top  = e.originalEvent.pageY + 'px';
  contextMenu.style.display = 'block';
}

// Hide the HTML context menu
function hideContextMenu() {
  contextMenu.style.display = 'none';
  currentContextMarker = null;
}

// Prompt the user to rename a marker
function renameMarker(marker) {
  const name = prompt('Enter new name:', marker.options.name || '');
  if (name && name.trim()) {
    marker.options.name = name.trim();
    marker.bindTooltip(name, { permanent: false, direction: 'top' });
  }
}

// Utility: generate a random hex color
function getRandomColor() {
  const hex = '0123456789ABCDEF';
  return '#' + Array.from({ length: 6 }, 
    () => hex[Math.floor(Math.random() * 16)]
  ).join('');
}


/* ─────────────── STORAGE ─────────────── */

// Remove all routes from map & memory, clear sidebar & storage
function clearAllRoutes() {
  routes.forEach(route => {
    [route.start, route.end].forEach(m => m && map.removeLayer(m));
    route.midMarkers.forEach(m => map.removeLayer(m));
    if (route.polyline) map.removeLayer(route.polyline);
  });
  routes = [];
  currentRouteIndex = null;
  localStorage.removeItem('routes');
  updateRouteList();
}

// Save entire routes array into localStorage
function saveRoutesToLocalStorage() {
  const data = routes.map(route => ({
    id: route.id,
    name: route.name,
    visible: route.visible,
    color: route.color,
    start: route.start ? route.start.getLatLng() : null,
    end:   route.end   ? route.end.getLatLng()   : null,
    mid:   route.midMarkers.map(m => ({ ...m.getLatLng(), name: m.options.name || '' }))
  }));
  localStorage.setItem('routes', JSON.stringify(data));
}

// Load routes back from localStorage on page startup
function loadRoutesFromLocalStorage() {
  const saved = JSON.parse(localStorage.getItem('routes'));
  if (!saved) return;

  routes = saved.map(r => {
    // Re-create a clean route object
    const obj = {
      id: r.id,
      name: r.name,
      start: null,
      end: null,
      midMarkers: [],
      polyline: null,
      visible: r.visible,
      color: r.color
    };
    // Re-add start/end if they existed
    if (r.start) obj.start = createMainMarker(r.start, 'Start', obj);
    if (r.end)   obj.end   = createMainMarker(r.end,   'End',   obj);
    // Re-add any saved midpoints
    obj.midMarkers = r.mid.map(p => {
      const m = createMidpointMarker(p, obj);
      if (p.name) m.bindTooltip(p.name, { permanent: false, direction: 'top' });
      return m;
    });
    // Generate mids if needed
    if (obj.start && obj.end && obj.midMarkers.length === 0) {
      createMidPoints(obj);
    }
    return obj;
  });

  updateRouteList();
  updateRoutePath();

  // Select first route by default if none chosen
  if (routes.length && currentRouteIndex === null) currentRouteIndex = 0;
}

// Immediately load saved routes on script load
loadRoutesFromLocalStorage();
