// Leaflet map of the grid: poles coloured by grade, spans coloured by line,
// the phone's live position and the trail walked so far.
import * as L from '/vendor/leaflet/leaflet-src.esm.js';
import { GRADE_INFO } from './grades.js';

const BASEMAPS = {
  street: () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 22, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
  satellite: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 22, maxNativeZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' }),
};

export function createMap(el, { onPoleClick, onMapClick } = {}) {
  const map = L.map(el, { zoomControl: false, preferCanvas: true, maxZoom: 22 }).setView([39.5, -98.35], 4);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: true, metric: true }).addTo(map);
  let basemapName = localStorageGet('lw.basemap') || 'satellite';
  let basemap = BASEMAPS[basemapName]().addTo(map);

  const spanLayer = L.layerGroup().addTo(map);
  const poleLayer = L.layerGroup().addTo(map);
  const labelLayer = L.layerGroup().addTo(map);
  const trailLayer = L.polyline([], { color: '#00b3ff', weight: 3, dashArray: '4 6', opacity: 0.9 }).addTo(map);
  const meAccuracy = L.circle([0, 0], { radius: 1, color: '#1a73e8', weight: 1, fillOpacity: 0.12, interactive: false });
  const meDot = L.circleMarker([0, 0], { radius: 7, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1, interactive: false });
  let selected = null, dragMarker = null, poleMarkers = new Map(), hasFitted = false, follow = false;

  map.on('click', e => onMapClick?.(e.latlng));
  map.on('dragstart', () => { follow = false; });
  map.on('zoomend moveend', () => renderLabels());

  let lastData = { poles: [], spans: [], lines: new Map(), filter: null };
  function render(data) {
    lastData = data;
    const { poles, spans, lines, filter } = data;
    spanLayer.clearLayers(); poleLayer.clearLayers(); poleMarkers = new Map();
    const byId = new Map(poles.map(p => [p.id, p]));
    for (const s of spans) {
      const a = byId.get(s.from_pole), b = byId.get(s.to_pole);
      if (!a || !b) continue;
      const color = lines.get(s.line_id || a.line_id)?.color || '#4b6b8a';
      L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color, weight: s.conductor === 'service' || s.conductor === 'secondary' ? 2 : 4, opacity: 0.9, dashArray: s.conductor === 'service' ? '3 5' : null, interactive: false }).addTo(spanLayer);
    }
    for (const p of poles) {
      const dim = filter && !filter.has(p.grade);
      const info = GRADE_INFO[p.grade] || GRADE_INFO.unreviewed;
      const m = L.circleMarker([p.lat, p.lng], {
        radius: p.id === selected ? 11 : 8, color: p.id === selected ? '#fff' : '#111', weight: p.id === selected ? 4 : 1.5,
        fillColor: info.color, fillOpacity: dim ? 0.25 : 1, opacity: dim ? 0.3 : 1,
      }).addTo(poleLayer);
      m.on('click', e => { L.DomEvent.stopPropagation(e); onPoleClick?.(p.id); });
      poleMarkers.set(p.id, m);
    }
    renderLabels();
    if (!hasFitted && poles.length) { fitTo(poles); hasFitted = true; }
  }

  // Pole tags are drawn only when zoomed in, and only for poles on screen.
  function renderLabels() {
    labelLayer.clearLayers();
    if (map.getZoom() < 17) return;
    const bounds = map.getBounds().pad(0.1);
    let n = 0;
    for (const p of lastData.poles) {
      if (!bounds.contains([p.lat, p.lng]) || n++ > 300) continue;
      L.marker([p.lat, p.lng], { interactive: false, icon: L.divIcon({ className: 'pole-label', html: `<span>${escapeHtml(p.tag)}</span>`, iconSize: null, iconAnchor: [-10, 8] }) }).addTo(labelLayer);
    }
  }

  function fitTo(poles) {
    if (!poles.length) return;
    if (poles.length === 1) return map.setView([poles[0].lat, poles[0].lng], 18);
    map.fitBounds(L.latLngBounds(poles.map(p => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 19 });
  }

  function setMe(fix) {
    if (!fix) return;
    const ll = [fix.lat, fix.lng];
    meAccuracy.setLatLng(ll).setRadius(fix.accuracy || 1);
    meDot.setLatLng(ll);
    if (!map.hasLayer(meDot)) { meAccuracy.addTo(map); meDot.addTo(map); }
    if (follow) map.panTo(ll, { animate: true });
  }

  return {
    map, render, fitTo, setMe,
    fitAll: () => fitTo(lastData.poles),
    followMe(on, fix) { follow = on; if (on && fix) map.setView([fix.lat, fix.lng], Math.max(map.getZoom(), 18)); },
    select(id) {
      selected = id;
      render(lastData);
      const p = lastData.poles.find(x => x.id === id);
      if (p && !map.getBounds().pad(-0.2).contains([p.lat, p.lng])) map.panTo([p.lat, p.lng]);
    },
    setTrail(points) { trailLayer.setLatLngs(points.map(p => [p.lat, p.lng])); },
    setBasemap(name) {
      if (!BASEMAPS[name] || name === basemapName) return;
      map.removeLayer(basemap); basemap = BASEMAPS[name]().addTo(map); basemap.bringToBack();
      basemapName = name; localStorageSet('lw.basemap', name);
    },
    basemap: () => basemapName,
    // Move a pole by dragging a handle; resolves with the new position or null.
    startDrag(pole) {
      dragMarker?.remove();
      return new Promise(resolve => {
        dragMarker = L.marker([pole.lat, pole.lng], { draggable: true, autoPan: true, icon: L.divIcon({ className: 'drag-handle', html: '<span></span>', iconSize: [36, 36], iconAnchor: [18, 18] }) }).addTo(map);
        map.setView([pole.lat, pole.lng], Math.max(map.getZoom(), 19));
        const finish = ok => { const ll = dragMarker.getLatLng(); dragMarker.remove(); dragMarker = null; resolve(ok ? { lat: ll.lat, lng: ll.lng } : null); };
        this.finishDrag = finish;
      });
    },
    finishDrag: () => {},
    invalidate: () => map.invalidateSize(),
  };
}

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }
