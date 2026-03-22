// ============================================================
// app.js — CarbonGIS Main Logic v2
// ============================================================

// ── COORDINATE SYSTEM UTILS ──────────────────────────────────
// Supported: 'wgs84' | 'utm' | 'dms'
let _coordSys = "wgs84";

/** WGS84 decimal degrees → UTM easting/northing/zone */
function latLonToUtm(lat, lon) {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const k0 = 0.9996;

  const zone = Math.floor((lon + 180) / 6) + 1;
  const lon0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const latR = (lat * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;

  const N = a / Math.sqrt(1 - e2 * Math.sin(latR) ** 2);
  const T = Math.tan(latR) ** 2;
  const C = ep2 * Math.cos(latR) ** 2;
  const A = Math.cos(latR) * (lonR - lon0);
  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * latR -
      ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) *
      Math.sin(2 * latR) +
      ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * latR) -
      ((35 * e2 ** 3) / 3072) * Math.sin(6 * latR));

  const E =
    k0 *
    N *
    (A +
      ((1 - T + C) * A ** 3) / 6 +
      ((5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5) / 120) +
    500000;
  const Nraw =
    k0 *
    (M +
      N *
      Math.tan(latR) *
      (A ** 2 / 2 +
        ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
        ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));

  const bands = "CDEFGHJKLMNPQRSTUVWX";
  const band =
    lat >= -80 && lat <= 84 ? bands[Math.floor((lat + 80) / 8)] || "Z" : "Z";
  return {
    zone,
    band,
    easting: Math.round(E),
    northing: Math.round(lat < 0 ? Nraw + 10000000 : Nraw),
  };
}

/** Decimal degrees → DMS string */
function decToDms(deg, isLat) {
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const mf = (abs - d) * 60;
  const m = Math.floor(mf);
  const s = ((mf - m) * 60).toFixed(1);
  const dir = isLat ? (deg >= 0 ? "N" : "S") : deg >= 0 ? "E" : "W";
  return `${d}°${m}'${s}"${dir}`;
}

/** Format latlng according to current coord system */
function fmtCoord(lat, lon) {
  if (_coordSys === "utm") {
    const u = latLonToUtm(lat, lon);
    return `Zone ${u.zone}${u.band}  E ${u.easting.toLocaleString()}  N ${u.northing.toLocaleString()}`;
  }
  if (_coordSys === "dms") {
    return `${decToDms(lat, true)}  ${decToDms(lon, false)}`;
  }
  // WGS84
  return `${lat.toFixed(6)}°,  ${lon.toFixed(6)}°`;
}

/**
 * Format area (in hectares) according to current coord system:
 *  WGS84 / DMS → "X.XX ha"
 *  UTM          → "X,XXX m²"  (if < 100 ha) or "X.XX ha" with m² in parentheses
 */
function fmtArea(ha) {
  if (_coordSys === "utm") {
    const m2 = ha * 10000;
    if (m2 < 1000000) {
      return `${m2.toLocaleString("id-ID", { maximumFractionDigits: 0 })} m²`;
    }
    return `${ha.toFixed(2)} ha (${m2.toLocaleString("id-ID", { maximumFractionDigits: 0 })} m²)`;
  }
  // WGS84 / DMS
  return `${ha.toFixed(2)} ha`;
}

/** Switch coordinate system & update button state */
function setCoordSys(sys) {
  _coordSys = sys;
  ["wgs84", "utm", "dms"].forEach((s) => {
    const btn = document.getElementById("csb-" + s);
    if (btn) btn.classList.toggle("active", s === sys);
  });
  const lbl = document.getElementById("coord-prefix");
  if (lbl)
    lbl.textContent =
      sys === "utm" ? "UTM:" : sys === "dms" ? "DMS:" : "WGS84:";
  // Re-render area displays
  updateStatus();
  if (state.stock) renderResult(state.totalArea, state.stock);
}

let _coordSys2 = "wgs84";
function setCoordSys2(sys) {
  _coordSys2 = sys;
  ["wgs84", "utm", "dms"].forEach((s) => {
    const btn = document.getElementById("csb2-" + s);
    if (btn) btn.classList.toggle("active", s === sys);
  });
  const lbl = document.getElementById("coord-prefix2");
  if (lbl)
    lbl.textContent =
      sys === "utm" ? "UTM:" : sys === "dms" ? "DMS:" : "WGS84:";
}

// ── STATE ────────────────────────────────────────────────────
const state = {
  method: "ipcc", // 'ipcc' | 'nfi' | 'lefebvre'
  year: "2024",
  drawnPolygons: [], // [{ points, area, layerId }]
  uploadedFiles: [],
  raster: null, // loaded land-cover GeoTIFF
  rasterOverlay: null,
  classData: {},
  totalArea: 0,
  stock: null,
  mapInstance: null,
  map2Instance: null,
  drawnItems: null,
  isDrawing: false,
  currentTab: "carbon",
  // IPCC-specific
  demFile: null,
  demRaster: null, // loaded DEM GeoTIFF
  shpFile: null,
  shpPolygon: null, // [[lng,lat],...] rings from shapefile
  shpLayer: null, // Leaflet polygon layer
  // Dual-layer visualization
  coverLayer: null, // land-cover class colors overlay
  carbonLayer: null, // carbon density gradient overlay
  activeMapLayer: "cover",
  // KLHK (nfi) — pre-loaded MapBiomas database
  klhkYear: null, // selected year string e.g. "2024"
  klhkPrecomputed: null, // pre-computed JSON dari precompute.py (YYYY_data.json)
  nfiShpPolygon: null, // auto-loaded hutan.shp rings [[lng,lat],...][]
  nfiShpLayer: null, // Leaflet polygon layer for NFI boundary
  nfiShpFeatures: null, // GeoJSON features lengkap dengan properties
  _shpFeatureMap: {}, // stamp → Leaflet layer map untuk click handler
  forestCarbonData: [], // hasil stok karbon per nama hutan (KLHK)
  carbonByYear: null, // {2015: {totalAreaHa, totalCarbon, agb, bgb, co2, byClass}, ...}
  // Literature-specific
  carbonStockRaster: null, // loaded Stock Carbon GeoTIFF (Landsat 8, pre-computed tC/ha)
  litPrecomputed: null, // JSON pre-computed {year, totalCarbon, totalAreaHa, byNama}
  litShpFile: null,
  litShpPolygon: null, // [[lng,lat],...] rings for Literature boundary
  litShpLayer: null, // Leaflet polygon layer for Literature
  // Conservation & Restoration Classification
  conservationClassification: null, // classification results from calculateAllClassifications()
  nfiShpLayerMap2: null, // Leaflet layer group for map2 conservation visualization
};

// Palette warna per namobj unik — dipakai di layer "Nama Hutan"
const FOREST_NAME_PALETTE = [
  "#1a6b2e",
  "#00897b",
  "#e67e00",
  "#7b1fa2",
  "#0288d1",
  "#f9a825",
  "#5d4037",
  "#d32f2f",
  "#0d47a1",
  "#ff5722",
  "#388e3c",
  "#4527a0",
  "#00838f",
  "#bf360c",
  "#37474f",
];

// ── DOM UTILS ────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const tx = (id, txt) => {
  const el = $(id);
  if (el) el.textContent = txt;
};
const ih = (id, html) => {
  const el = $(id);
  if (el) el.innerHTML = html;
};

// ── GLOBAL LOADER ────────────────────────────────────────────
function showLoader(text = "Memuat Peta...") {
  const loader = $("global-loader");
  const loaderText = $("loader-text");
  if (loader && loaderText) {
    loaderText.textContent = text;
    loader.style.display = "flex";
    // Slight delay to allow display: flex to apply before transitioning opacity
    requestAnimationFrame(() => {
      loader.classList.add("visible");
    });
  }
}

function hideLoader() {
  const loader = $("global-loader");
  if (loader) {
    loader.classList.remove("visible");
    setTimeout(() => {
      loader.style.display = "none";
    }, 300); // match CSS transition duration
  }
}

// ── LANGUAGE ─────────────────────────────────────────────────
function handleSetLang(l) {
  _lang = l;
  setLang(l);
  $("btn-id").classList.toggle("active", l === "id");
  $("btn-en").classList.toggle("active", l === "en");
  applyLabels();
  renderLegend();
}

function applyLabels() {
  const map = [
    ["lbl-tagline", "tagline"],
    ["sec-upload", "secUpload"],
    ["sec-tools", "secTools"],
    ["sec-method", "secMethod"],
    ["sec-year", "secYear"],
    ["lbl-draw", "toolDraw"],
    ["lbl-reset", "toolReset"],
    ["lbl-calc", "btnCalc"],
    ["lbl-export", "btnExport"],
    ["lbl-res-title", "resTitle"],
    ["lbl-total-stock", "resTotal"],
    ["lbl-equiv", "resEquiv"],
    ["lbl-breakdown", "resBreakdown"],
    ["lbl-above", "resAbove"],
    ["lbl-below", "resBelow"],
    ["lbl-source", "resSource"],
    ["lbl-legend", "lblLegend"],
    ["lbl-area", "areaLabel"],
    ["tab-lbl-carbon", "tabCarbon"],
    ["tab-lbl-konservasi", "tabKonservasi"],
    ["tab-lbl-statistik", "tabStatistik"],
    ["lbl-class-title", "lblClassTitle"],
  ];
  map.forEach(([id, key]) => tx(id, t(key)));
  ih("lbl-drop", t("dropHint"));
  const hint = $("draw-hint");
  if (hint) hint.textContent = t("drawHint");
}

// ── TAB SWITCH ───────────────────────────────────────────────
function switchTab(tab) {
  state.currentTab = tab;
  document
    .querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document
    .querySelectorAll(".tab-pane")
    .forEach((p) => p.classList.toggle("active", p.id === "pane-" + tab));

  // Extra logic per tab
  if (tab === "carbon") {
    // Re-trigger resize map
    if (state.mapInstance) state.mapInstance.invalidateSize();
  } else if (tab === "konservasi") {
    if (!state.map2Instance) {
      showLoader("Memuat Peta Konservasi...");
      setTimeout(() => {
        initMap2();
        hideLoader();
      }, 50); // small delay to paint loader
    } else {
      state.map2Instance.invalidateSize();
    }
  } else if (tab === "statistik") {
    // Re-render chart jika diperlukan
    if (state.carbonByYear) {
      renderMultiYearCharts(state.carbonByYear);
    }
  }
}

// ── METODOLOGI ───────────────────────────────────────────────
function selectMethod(m) {
  state.method = m;
  document.body.dataset.method = m;
  document.querySelectorAll(".method-chip").forEach((el, i) => {
    const methods = ["ipcc", "nfi", "lefebvre"];
    el.classList.toggle("active", methods[i] === m);
  });
  const labels = { ipcc: "IPCC 2019", nfi: "KLHK", lefebvre: "Literature" };
  tx("st-method", labels[m] || "IPCC 2019");
  const badge = $("res-method-badge");
  if (badge) badge.textContent = labels[m] || "IPCC 2019";
  // Auto-load assets per method
  if (state.mapInstance) {
    if (m === "ipcc") {
      loadNfiShp();
      loadIpccDem();
    } else if (m === "nfi") loadNfiShp();
    else if (m === "lefebvre") {
      loadNfiShp();
      // Auto-load Stock Carbon 2016 saat pertama kali pilih Literature
      setTimeout(() => {
        if (!state.litPrecomputed) setLitYear(2016);
      }, 300);
    }
  }
  toggleCalcBtn();
}

function handleYearChange(y) {
  state.year = y;
}

// ── LAYER TOGGLE ──────────────────────────────────────────────
function setMapLayer(type) {
  state.activeMapLayer = type;
  $("ltg-cover")?.classList.toggle("active", type === "cover");
  $("ltg-carbon")?.classList.toggle("active", type === "carbon");
  $("ltg-namaHutan")?.classList.toggle("active", type === "namaHutan");
  const coverOp = type === "cover" ? 0.78 : 0;
  const carbonOp = type === "carbon" ? 0.82 : 0;
  if (state.coverLayer) state.coverLayer.setOpacity(coverOp);
  if (state.carbonLayer) state.carbonLayer.setOpacity(carbonOp);

  // SHP layer: tampil di namaHutan; Literature juga tampil di carbon
  const isLitActive = state.method === "lefebvre";
  if (state.nfiShpLayer) {
    state.nfiShpLayer.eachLayer((l) => {
      const showShp =
        type === "namaHutan" || (type === "carbon" && isLitActive);
      if (showShp && l._namaColor) {
        const isLitMode = isLitActive && l._litColor;
        const fillColor = isLitMode ? l._litColor : l._namaColor;
        l.setStyle(
          isLitMode
            ? {
              fillColor,
              fillOpacity: 0.75,
              color: "#1a3a1a",
              weight: 0.8,
              opacity: 0.5,
            }
            : {
              fillColor,
              fillOpacity: 0.55,
              color: fillColor,
              weight: 1.5,
              opacity: 1,
            },
        );
        // Re-bind tooltip nama hutan jika belum ada
        if (!l.getTooltip() && l._shpNama) {
          l.bindTooltip(`<strong>${l._shpNama}</strong>`, {
            sticky: true,
            className: "shp-tooltip",
          });
        }
      } else {
        // cover / carbon non-Literature: sembunyikan layer SHP
        l.setStyle({ fillOpacity: 0, opacity: 0, weight: 0 });
        l.unbindTooltip();
      }
    });
  }

  // Raster click handler: aktif di mode cover & carbon, nonaktif di namaHutan
  if (state.mapInstance) {
    state.mapInstance.off("click", _onMapClickRasterInfo);
    if (type === "cover" || type === "carbon") {
      state.mapInstance.on("click", _onMapClickRasterInfo);
    }
  }

  // Bottom bar per-hutan: namaHutan, atau carbon saat Literature
  const showBottomBar =
    type === "namaHutan" || (type === "carbon" && isLitActive);
  if (showBottomBar && state.forestCarbonData?.length) {
    renderBottomBar(state.forestCarbonData);
    renderForestStatsTable(state.forestCarbonData);
  } else {
    $("bottom-bar")?.classList.remove("visible");
  }

  updateMapLegend(type);
}

// ── MAP LAYER LEGEND (bottom-left overlay, context-sensitive) ──
function updateMapLegend(type) {
  const panel = $("map-layer-legend");
  const titleEl = $("mll-title");
  const body = $("mll-body");
  if (!panel || !titleEl || !body) return;

  if (type === "cover") {
    let html = "";
    if (state.method === "ipcc" && state.coverLayer) {
      titleEl.textContent = "Tutupan Lahan IPCC";
      html = `
        <div class="mll-item">
          <span class="mll-dot" style="background:#22a755"></span>
          <span class="mll-label">Hutan Hujan Tropis</span>
        </div>
        <div style="font-size:10px;color:#7a9a80;margin:0 0 5px 18px">Dataran rendah &lt; 1.000m dpl</div>
        <div class="mll-item">
          <span class="mll-dot" style="background:#7c3aed"></span>
          <span class="mll-label">Ekosistem Pegunungan Tropis</span>
        </div>
        <div style="font-size:10px;color:#7a9a80;margin:0 0 2px 18px">Dataran tinggi ≥ 1.000m dpl</div>
      `;
    } else if (state.method === "literature" && state.coverLayer) {
      titleEl.textContent = "Tutupan Lahan NDVI";
      html = [
        { color: "#0d4a27", label: "Stok Karbon Tinggi (NDVI ≥ 0.65)" },
        { color: "#4caf50", label: "Stok Karbon Sedang (≥ 0.50)" },
        { color: "#c8e6c9", label: "Stok Karbon Rendah (< 0.50)" },
      ]
        .map(
          ({ color, label }) => `
        <div class="mll-item">
          <span class="mll-dot" style="background:${color}"></span>
          <span class="mll-label">${label}</span>
        </div>`,
        )
        .join("");
    } else {
      titleEl.textContent = "Tutupan Lahan";
      // Hanya tampilkan kelas yang memiliki data (areaHa > 0)
      html =
        Object.entries(LANDCOVER_CLASS_VALUES)
          .filter(([code]) => (state.classData?.[code]?.areaHa || 0) > 0)
          .map(([, cls]) => {
            const name = _lang === "id" ? cls.nameId : cls.name;
            return `<div class="mll-item">
            <span class="mll-dot" style="background:${cls.color}"></span>
            <span class="mll-label">${name}</span>
          </div>`;
          })
          .join("") ||
        Object.entries(LANDCOVER_CLASS_VALUES)
          .map(([, cls]) => {
            // Fallback: tampilkan semua jika belum ada data
            const name = _lang === "id" ? cls.nameId : cls.name;
            return `<div class="mll-item">
            <span class="mll-dot" style="background:${cls.color}"></span>
            <span class="mll-label">${name}</span>
          </div>`;
          })
          .join("");
    }
    body.innerHTML = html;
    panel.style.display = "";
  } else if (type === "carbon") {
    titleEl.textContent = "Stok Karbon (tC/ha)";
    let minLabel = "Rendah",
      maxLabel = "Tinggi";
    let barStyle = "";
    if (state.method === "lefebvre" && state._litByNama?.length) {
      // Literature: gradient hijau dari _litByNama (hanya nilai positif)
      const densities = state._litByNama
        .filter((i) => i.areaHa > 0 && i.carbon > 0)
        .map((i) => i.carbon / i.areaHa);
      if (densities.length) {
        minLabel = Math.min(...densities).toFixed(2) + " tC/ha";
        maxLabel = Math.max(...densities).toFixed(2) + " tC/ha";
      }
      barStyle =
        "background:linear-gradient(to right,#c7e8c2,#1a6b2e);height:10px;border-radius:4px;margin-bottom:4px";
    } else if (state.classData && Object.keys(state.classData).length) {
      const densities = Object.values(state.classData)
        .filter((d) => d.areaHa > 0 && d.carbon > 0)
        .map((d) => d.carbon / d.areaHa);
      if (densities.length) {
        minLabel = Math.min(...densities).toFixed(0) + " tC/ha";
        maxLabel = Math.max(...densities).toFixed(0) + " tC/ha";
      }
    }
    body.innerHTML = `
      <div class="mll-bar"${barStyle ? ` style="${barStyle}"` : ""}></div>
      <div class="mll-bar-labels"><span>${minLabel}</span><span>${maxLabel}</span></div>
    `;
    panel.style.display = "";
  } else if (type === "namaHutan") {
    if (state.method === "lefebvre" && state._litByNama?.length) {
      // Choropleth legend untuk Literature
      titleEl.textContent = "Stok Karbon (tC/ha)";
      const densities = state._litByNama
        .filter((i) => i.areaHa > 0)
        .map((i) => i.carbon / i.areaHa);
      const minD = densities.length
        ? Math.min(...densities).toFixed(1)
        : "Rendah";
      const maxD = densities.length
        ? Math.max(...densities).toFixed(1)
        : "Tinggi";
      body.innerHTML = `
        <div class="mll-bar" style="background:linear-gradient(to right,#c7e8c2,#1a6b2e);height:10px;border-radius:4px;margin-bottom:4px"></div>
        <div class="mll-bar-labels"><span>${minD} tC/ha</span><span>${maxD} tC/ha</span></div>
      `;
    } else {
      titleEl.textContent = "Nama Hutan";
      const colorMap = state._namaColorMap || {};
      const entries = Object.entries(colorMap);
      if (entries.length) {
        body.innerHTML = entries
          .map(
            ([nama, color]) => `
          <div class="mll-item">
            <span class="mll-dot" style="background:${color}"></span>
            <span class="mll-label" title="${nama}">${nama}</span>
          </div>`,
          )
          .join("");
      } else {
        body.innerHTML = `<div style="font-size:10px;color:#7aa89a">Muat SHP untuk melihat legenda.</div>`;
      }
    }
    panel.style.display = "";
  } else {
    panel.style.display = "none";
  }
}

// ── RASTER PIXEL INSPECTOR ───────────────────────────────────

/** Ambil nilai pixel raster pada koordinat lat/lng (WGS84) */
function _getRasterValueAtLatLng(raster, lat, lng) {
  const [minX, minY, maxX, maxY] = raster.bbox;
  let x, y;
  if (raster.crs?.type === "utm") {
    const pt = wgs84ToUtmPoint(lat, lng, raster.crs.zone);
    x = pt.easting;
    y = pt.northing;
  } else {
    x = lng;
    y = lat;
  }
  if (x < minX || x > maxX || y < minY || y > maxY) return null;
  const col = Math.floor(((x - minX) / (maxX - minX)) * raster.width);
  const row = Math.floor(((maxY - y) / (maxY - minY)) * raster.height);
  const c = Math.max(0, Math.min(raster.width - 1, col));
  const r = Math.max(0, Math.min(raster.height - 1, row));
  const val = raster.data[r * raster.width + c];
  if (val == null || val === raster.nodata) return null;
  return val;
}

/** Handler klik peta untuk mode cover / carbon — tampilkan info pixel */
function _onMapClickRasterInfo(e) {
  if (!state.raster) return;
  const { lat, lng } = e.latlng;
  const val = _getRasterValueAtLatLng(state.raster, lat, lng);
  if (val == null) return;
  const code = Math.round(val);
  const cls = LANDCOVER_CLASS_VALUES[code];
  if (!cls) return;

  const mode = state.activeMapLayer;
  const name = _lang === "id" ? cls.nameId : cls.name;
  let content = "";

  if (mode === "cover") {
    content = `
      <div style="font-family:inherit;padding:4px 2px;min-width:170px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
          <span style="width:11px;height:11px;border-radius:50%;background:${cls.color};flex-shrink:0;display:inline-block"></span>
          <span style="font-size:13px;font-weight:700;color:#1a6b2e">${name}</span>
        </div>
        <div style="font-size:10px;color:#7aa89a">Kode kelas: ${code}</div>
      </div>`;
  } else if (mode === "carbon") {
    const d = state.classData?.[code];
    let densityStr;
    if (d && d.areaHa > 0) {
      densityStr = (d.carbon / d.areaHa).toFixed(1) + " tC/ha";
    } else {
      densityStr = (cls.agb + cls.bgb).toFixed(1) + " tC/ha";
    }
    content = `
      <div style="font-family:inherit;padding:4px 2px;min-width:170px">
        <div style="font-size:13px;font-weight:700;color:#1a6b2e;margin-bottom:4px">${name}</div>
        <div style="font-size:12px;color:#333">Stok Karbon: <strong>${densityStr}</strong></div>
      </div>`;
  }

  if (content) {
    L.popup({ maxWidth: 260, className: "raster-info-popup" })
      .setLatLng(e.latlng)
      .setContent(content)
      .openOn(state.mapInstance);
  }
}

// ── LEGEND ───────────────────────────────────────────────────
function renderLegend() {
  const list = $("legend-list");
  if (!list) return;
  list.innerHTML = "";
  Object.entries(LANDCOVER_CLASS_VALUES).forEach(([code, cls]) => {
    const name = _lang === "id" ? cls.nameId : cls.name;
    const areaHa = state.classData?.[code]?.areaHa || 0;
    const div = document.createElement("div");
    div.className = "legend-item";
    div.innerHTML = `
      <span class="li-dot" style="background:${cls.color}"></span>
      <span>${name}</span>
      ${areaHa > 0 ? `<span class="li-area">${fmtDec(areaHa, 0)} ha</span>` : ""}
    `;
    list.appendChild(div);
  });
}

// ── MAP INIT ─────────────────────────────────────────────────
function initMap() {
  const container = $("map");
  if (!window.L || container._leaflet_id) return;

  const map = L.map(container, {
    center: [-2.5, 118],
    zoom: 5,
    zoomControl: false,
  });
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution: "© CartoDB © OSM",
      subdomains: "abcd",
      maxZoom: 20,
    },
  ).addTo(map);
  L.control.zoom({ position: "bottomright" }).addTo(map);

  const drawnItems = new L.FeatureGroup().addTo(map);
  const drawCtrl = new L.Control.Draw({
    position: "topleft",
    draw: {
      polyline: false,
      circle: false,
      circlemarker: false,
      marker: false,
      rectangle: {
        shapeOptions: {
          color: "#52b788",
          weight: 2.5,
          fillColor: "#40916c",
          fillOpacity: 0.3,
        },
      },
      polygon: {
        allowIntersection: false,
        shapeOptions: {
          color: "#52b788",
          weight: 2.5,
          fillColor: "#40916c",
          fillOpacity: 0.3,
        },
      },
    },
    edit: { featureGroup: drawnItems, remove: true },
  });
  map.addControl(drawCtrl);

  map.on(L.Draw.Event.CREATED, (e) => {
    const layer = e.layer;
    drawnItems.addLayer(layer);
    const ll = layer.getLatLngs()[0];
    const areaHa = L.GeometryUtil.geodesicArea(ll) / 10000;
    const id_ = L.stamp(layer);
    state.drawnPolygons.push({
      points: ll.map((x) => [x.lat, x.lng]),
      area: areaHa,
      layerId: id_,
    });
    state.isDrawing = false;
    $("tool-draw")?.classList.remove("active");
    $("draw-hint")?.classList.remove("visible");
    updateStatus();
    toggleCalcBtn();
  });

  map.on(L.Draw.Event.EDITED, (e) => {
    e.layers.eachLayer((layer) => {
      if (!layer.getLatLngs) return;
      const ll = layer.getLatLngs()[0];
      const areaHa = L.GeometryUtil.geodesicArea(ll) / 10000;
      const id_ = L.stamp(layer);
      const idx = state.drawnPolygons.findIndex((p) => p.layerId === id_);
      if (idx > -1) state.drawnPolygons[idx].area = areaHa;
    });
    updateStatus();
    toggleCalcBtn();
  });

  map.on(L.Draw.Event.DELETED, (e) => {
    const ids = [];
    e.layers.eachLayer((l) => ids.push(L.stamp(l)));
    state.drawnPolygons = state.drawnPolygons.filter(
      (p) => !ids.includes(p.layerId),
    );
    updateStatus();
    toggleCalcBtn();
  });

  map.on("mousemove", (e) => {
    tx("st-coord", fmtCoord(e.latlng.lat, e.latlng.lng));
  });

  state.mapInstance = map;
  state.drawnItems = drawnItems;
  setTimeout(() => map.invalidateSize(), 200);
}

function initMap2() {
  const container = $("map2");
  if (!window.L || !container || container._leaflet_id) return;

  const map2 = L.map(container, {
    center: [-2.5, 118],
    zoom: 5,
    zoomControl: false,
  });
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution: "© CartoDB © OSM",
      subdomains: "abcd",
      maxZoom: 20,
    },
  ).addTo(map2);
  L.control.zoom({ position: "bottomright" }).addTo(map2);

  map2.on("mousemove", (e) => {
    const saved = _coordSys;
    _coordSys = _coordSys2;
    tx("st-coord2", fmtCoord(e.latlng.lat, e.latlng.lng));
    _coordSys = saved;
  });

  state.map2Instance = map2;

  // Initialize conservation classification when map2 is created
  // First, load the forest SHP if not already loaded
  initConservationClassification();

  // Dummy konservasi stats dari state
  if (state.totalArea > 0) {
    tx("ks-total-area", fmtDec(state.totalArea) + " ha");
    tx("ks-carbon-protect", fmt(state.stock?.total ?? 0) + " tC");
    tx("ks-species", "~" + Math.round(state.totalArea * 0.012) + " spp");
  }

  setTimeout(() => map2.invalidateSize(), 200);
}

/**
 * Initialize conservation classification on map2
 * Loads forest SHP and calculates classification
 */
async function initConservationClassification() {
  // Load forest SHP first if not loaded
  if (!state.nfiShpPolygon && !state.nfiShpFeatures) {
    await loadNfiShp();
  }

  // If SHP is now available, copy it to map2
  if (state.nfiShpFeatures && state.map2Instance) {
    // Create a new layer group for map2
    if (!state.map2Instance.getPane("shpPane")) {
      state.map2Instance.createPane("shpPane").style.zIndex = 450;
    }

    const group = L.featureGroup().addTo(state.map2Instance);

    state.nfiShpFeatures.forEach((feat) => {
      const geom = feat.geometry || feat;
      const props = feat.properties || {};
      if (!geom?.coordinates) return;

      const nama =
        props["NAMOBJ"] ||
        props["namobj"] ||
        props["NamObj"] ||
        Object.keys(props).reduce(
          (v, k) =>
            v || (/nama|name|kawasan|wilayah/i.test(k) ? props[k] : null),
          null,
        ) ||
        "Area Hutan";

      const toLeaflet = (ring) => ring.map(([lng, lat]) => [lat, lng]);
      let leafletCoords;
      if (geom.type === "Polygon") {
        leafletCoords = geom.coordinates.map(toLeaflet);
      } else if (geom.type === "MultiPolygon") {
        leafletCoords = geom.coordinates.map((poly) => poly.map(toLeaflet));
      } else return;

      const layer = L.polygon(leafletCoords, {
        color: "#666",
        weight: 1,
        fillOpacity: 0,
        pane: "shpPane",
      }).addTo(group);

      layer._shpNama = nama;

      // Click handler for classification popup
      layer.on("click", function (e) {
        L.DomEvent.stopPropagation(e);
        showClassificationPopup(layer, e);
      });
    });

    // Store reference for later coloring
    state.nfiShpLayerMap2 = group;

    // Fit bounds to data
    const bounds = group.getBounds();
    if (bounds.isValid()) {
      state.map2Instance.fitBounds(bounds, { padding: [30, 30] });
    }

    // Calculate and render classification
    setTimeout(async () => {
      const classification = await calculateConservationClassification();
      if (classification && classification.length > 0) {
        renderConservationMapOnMap2(classification);
      }
    }, 500);
  }
}

/**
 * Render conservation classification on map2
 */
function renderConservationMapOnMap2(classificationResults) {
  if (!state.map2Instance || !state.nfiShpLayerMap2) return;

  // Create a map of forest names to their classification
  const classMap = {};
  classificationResults.forEach((c) => {
    classMap[c.nama] = c;
  });

  // Update polygon colors based on classification
  state.nfiShpLayerMap2.eachLayer((layer) => {
    const nama = layer._shpNama;
    const classification = classMap[nama];

    if (classification) {
      const color = classification.category.color;
      layer.setStyle({
        fillColor: color,
        fillOpacity: 0.7,
        color: "#333",
        weight: 1.5,
      });
      layer._classification = classification;
    } else {
      // Default gray for unclassified
      layer.setStyle({
        fillColor: "#ccc",
        fillOpacity: 0.5,
        color: "#666",
        weight: 1,
      });
    }
  });

  // Update the legend
  renderConservationLegend(classificationResults);

  // Update stats panel
  updateConservationStats(classificationResults);
}

// ── DRAW TOOL ────────────────────────────────────────────────
function activateDraw() {
  if (!state.mapInstance) return;
  const btn = $("tool-draw");
  if (state.isDrawing) {
    state.isDrawing = false;
    btn?.classList.remove("active");
    $("draw-hint")?.classList.remove("visible");
    return;
  }
  state.isDrawing = true;
  btn?.classList.add("active");
  $("draw-hint")?.classList.add("visible");
  setTimeout(() => {
    document.querySelector(".leaflet-draw-draw-polygon")?.click();
  }, 120);
}

// ── FILE UPLOAD ──────────────────────────────────────────────
function triggerUpload() {
  $("file-input")?.click();
}

function handleDrop(e) {
  e.preventDefault();
  $("drop-zone")?.classList.remove("dragover");
  addFiles(Array.from(e.dataTransfer.files));
}
function handleDragOver(e) {
  e.preventDefault();
  $("drop-zone")?.classList.add("dragover");
}
function handleDragLeave() {
  $("drop-zone")?.classList.remove("dragover");
}

function addFiles(files) {
  // Only accept tif/tiff
  const tifFiles = files.filter(
    (f) =>
      f.name.toLowerCase().endsWith(".tif") ||
      f.name.toLowerCase().endsWith(".tiff"),
  );
  if (files.length && !tifFiles.length) {
    showError(t("errTif"));
    return;
  }
  state.uploadedFiles = [...state.uploadedFiles, ...tifFiles];
  renderFileList();
  toggleCalcBtn();
  showError("");
}

function renderFileList() {
  const list = $("file-list");
  if (!list) return;
  list.innerHTML = "";
  state.uploadedFiles.forEach((f, i) => {
    const div = document.createElement("div");
    div.className = "file-item";
    div.innerHTML = `
      <span class="fi-dot"></span>
      <span class="fi-name">${f.name}</span>
      <span class="fi-size">${(f.size / 1024).toFixed(0)} KB</span>
      <button class="fi-del" title="Hapus">×</button>`;
    div.querySelector(".fi-del").addEventListener("click", () => {
      state.uploadedFiles.splice(i, 1);
      if (!state.uploadedFiles.length) {
        state.raster = null;
        if (state.coverLayer) {
          state.coverLayer.remove();
          state.coverLayer = null;
        }
        if (state.carbonLayer) {
          state.carbonLayer.remove();
          state.carbonLayer = null;
        }
        const riEl = $("raster-info");
        if (riEl) {
          riEl.innerHTML = "";
          riEl.style.display = "none";
        }
      }
      renderFileList();
      toggleCalcBtn();
    });
    list.appendChild(div);
  });
}

// ── SHP / DEM UPLOAD ─────────────────────────────────────────
function triggerShpUpload() {
  $("shp-input")?.click();
}
function triggerDemUpload() {
  $("dem-input")?.click();
}

function handleShpDrop(e) {
  e.preventDefault();
  $("drop-zone-shp")?.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) processShpFile(file);
}

function handleDemDrop(e) {
  e.preventDefault();
  $("drop-zone-dem")?.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) processDemFile(file);
}

async function processShpFile(file) {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    showError("⚠ Upload file .zip yang berisi Shapefile (.shp + .dbf + .prj).");
    return;
  }
  showError("");
  try {
    const rings = await loadShapefile(file);
    state.shpFile = file;
    state.shpPolygon = rings;
    if (state.shpLayer) {
      state.shpLayer.remove();
      state.shpLayer = null;
    }
    if (state.mapInstance)
      state.shpLayer = addShpToMap(rings, state.mapInstance);
    renderShpFileItem(file);
    toggleCalcBtn();
  } catch (err) {
    showError("⚠ Gagal memuat Shapefile: " + err.message);
  }
}

async function processDemFile(file) {
  if (!file.name.toLowerCase().match(/\.tiff?$/)) {
    showError("⚠ Upload file DEM berformat .tif/.tiff.");
    return;
  }
  showError("");
  try {
    state.demRaster = await loadDemTiff(file);
    state.demFile = file;
    renderDemFileItem(file);
    toggleCalcBtn();
  } catch (err) {
    showError("⚠ Gagal memuat DEM: " + err.message);
  }
}

function renderShpFileItem(file) {
  const list = $("shp-file-list");
  if (!list) return;
  list.innerHTML = "";
  const div = document.createElement("div");
  div.className = "file-item";
  div.innerHTML = `
    <span class="fi-dot" style="background:#f2cc8f"></span>
    <span class="fi-name">${file.name}</span>
    <span class="fi-size">${(file.size / 1024).toFixed(0)} KB</span>
    <button class="fi-del" title="Hapus">×</button>`;
  div.querySelector(".fi-del").addEventListener("click", clearShp);
  list.appendChild(div);
}

function renderDemFileItem(file) {
  const list = $("dem-file-list");
  if (!list) return;
  list.innerHTML = "";
  const div = document.createElement("div");
  div.className = "file-item";
  div.innerHTML = `
    <span class="fi-dot" style="background:#1b5e20"></span>
    <span class="fi-name">${file.name}</span>
    <span class="fi-size">${(file.size / 1024).toFixed(0)} KB</span>
    <button class="fi-del" title="Hapus">×</button>`;
  div.querySelector(".fi-del").addEventListener("click", clearDem);
  list.appendChild(div);
}

function clearShp() {
  state.shpFile = null;
  state.shpPolygon = null;
  if (state.shpLayer) {
    state.shpLayer.remove();
    state.shpLayer = null;
  }
  ih("shp-file-list", "");
  const shpIn = $("shp-input");
  if (shpIn) shpIn.value = "";
  toggleCalcBtn();
}

function clearDem() {
  state.demFile = null;
  state.demRaster = null;
  if (state.coverLayer) {
    state.coverLayer.remove();
    state.coverLayer = null;
  }
  if (state.carbonLayer) {
    state.carbonLayer.remove();
    state.carbonLayer = null;
  }
  ih("dem-file-list", "");
  const demIn = $("dem-input");
  if (demIn) demIn.value = "";
  toggleCalcBtn();
}

// ── LITERATURE SHP UPLOAD ────────────────────────────────────
function triggerShpUploadLit() {
  $("shp-input-lit")?.click();
}

function handleShpDropLit(e) {
  e.preventDefault();
  $("drop-zone-shp-lit")?.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) processLitShpFile(file);
}

async function processLitShpFile(file) {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    showError("⚠ Upload file .zip yang berisi Shapefile (.shp + .dbf + .prj).");
    return;
  }
  showError("");
  try {
    const rings = await loadShapefile(file);
    state.litShpFile = file;
    state.litShpPolygon = rings;
    if (state.litShpLayer) {
      state.litShpLayer.remove();
      state.litShpLayer = null;
    }
    if (state.mapInstance)
      state.litShpLayer = addShpToMap(rings, state.mapInstance);
    renderLitShpFileItem(file);
    toggleCalcBtn();
  } catch (err) {
    showError("⚠ Gagal memuat Shapefile: " + err.message);
  }
}

function renderLitShpFileItem(file) {
  const list = $("shp-file-list-lit");
  if (!list) return;
  list.innerHTML = "";
  const div = document.createElement("div");
  div.className = "file-item";
  div.innerHTML = `
    <span class="fi-dot" style="background:#f2cc8f"></span>
    <span class="fi-name">${file.name}</span>
    <span class="fi-size">${(file.size / 1024).toFixed(0)} KB</span>
    <button class="fi-del" title="Hapus">×</button>`;
  div.querySelector(".fi-del").addEventListener("click", clearLitShp);
  list.appendChild(div);
}

function clearLitShp() {
  state.litShpFile = null;
  state.litShpPolygon = null;
  if (state.litShpLayer) {
    state.litShpLayer.remove();
    state.litShpLayer = null;
  }
  ih("shp-file-list-lit", "");
  const shpIn = $("shp-input-lit");
  if (shpIn) shpIn.value = "";
  toggleCalcBtn();
}

// ── GEE AUTH HANDLERS ────────────────────────────────────────
function updateGeeStatus(connected, msg, isError) {
  const dot = $("gee-status-dot");
  const lbl = $("gee-status-lbl");
  if (dot) {
    dot.classList.toggle("connected", connected);
    dot.classList.toggle("error", !connected && !!isError);
  }
  if (lbl)
    lbl.textContent =
      msg || (connected ? "Terhubung ke GEE ✓" : "Belum terhubung ke GEE");
}

function handleGeeApplyToken() {
  const token = $("gee-token")?.value?.trim();
  if (!token) {
    showError("⚠ Token GEE kosong. Tempel token terlebih dahulu.");
    return;
  }
  geeSetToken(token);
  updateGeeStatus(true);
  showError("");
  toggleCalcBtn();
}

function handleGeeSignIn() {
  updateGeeStatus(false, "Menghubungkan...");
  geeSignIn(
    () => {
      updateGeeStatus(true);
      showError("");
      toggleCalcBtn();
    },
    (err) => {
      updateGeeStatus(false, "Gagal sign in", true);
      showError("⚠ GEE Sign-in gagal: " + err);
    },
  );
}

// ── KLHK: MapBiomas database helpers ─────────────────────────

/** Show status inside the klhk-status-row */
function showKlhkStatus(type, msg) {
  const row = $("klhk-status-row");
  const icon = $("klhk-status-icon");
  const text = $("klhk-status-text");
  if (!row) return;
  row.style.display = "flex";
  if (icon) {
    icon.className = `klhk-status-icon ${type}`;
    icon.textContent = type === "loading" ? "⟳" : type === "ok" ? "✓" : "✗";
  }
  if (text) text.textContent = msg;
}

/** Fetch mapbiomas/{year}.tif, parse, show overlay */
async function setKlhkYear(year) {
  state.klhkYear = String(year);
  state.year = String(year); // used in report export

  // Update button active states
  document.querySelectorAll(".klhk-yr-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.year === state.klhkYear);
    btn.classList.remove("loading");
  });
  const activeBtn = document.querySelector(`.klhk-yr-btn[data-year="${year}"]`);
  if (activeBtn) activeBtn.classList.add("loading");

  showKlhkStatus("loading", `Memuat ${year}.tif...`);

  // Remove previous overlays
  if (state.coverLayer) {
    state.coverLayer.remove();
    state.coverLayer = null;
  }
  if (state.carbonLayer) {
    state.carbonLayer.remove();
    state.carbonLayer = null;
  }
  state.raster = null;

  try {
    // Use fromUrl (COG-compatible, no ArrayBuffer wrapping needed)
    const url = `db_karbon/${year}.tif`;
    state.raster = await loadGeoTiffFromUrl(url, `${year}.tif`);

    // Coba load pre-computed JSON — jauh lebih cepat
    state.klhkPrecomputed = null;
    try {
      const resp = await fetch(`db_karbon/${year}_data.json`);
      if (resp.ok) {
        state.klhkPrecomputed = await resp.json();
        console.log(`[data] ${year}_data.json dimuat.`);
      }
    } catch (_) {
      /* tidak ada precomputed — akan sampling TIFF */
    }

    const { width, height } = state.raster;
    showKlhkStatus(
      "ok",
      `Data ${year} dimuat ✓ (${width}×${height} px · ${state.raster.crs?.type === "utm" ? "UTM" : "WGS84"})`,
    );
    if (activeBtn) activeBtn.classList.remove("loading");

    // Preview overlay on map
    if (state.mapInstance) {
      state.coverLayer = await addRasterOverlayToMap(
        state.raster,
        state.mapInstance,
      );
      state.mapInstance.fitBounds(getRasterBounds(state.raster), {
        padding: [30, 30],
      });
      const ltg = $("layer-toggle-group");
      if (ltg) ltg.style.display = "flex";
      setMapLayer("cover");
    }

    toggleCalcBtn();
    // Auto-process: langsung hitung stok karbon setelah data dimuat
    calculate();
  } catch (err) {
    if (activeBtn) activeBtn.classList.remove("loading");
    let msg = err.message;
    if (
      msg.includes("Failed to fetch") ||
      msg.includes("NetworkError") ||
      msg.includes("CORS") ||
      msg.toLowerCase().includes("fetch")
    ) {
      msg =
        "Tidak dapat memuat file. Jalankan aplikasi via HTTP server (VS Code Live Server / python -m http.server).";
    }
    showKlhkStatus("error", msg);
    state.raster = null;
    toggleCalcBtn();
  } finally {
    hideLoader();
  }
}

// ── TREN TAHUNAN: Load semua precomputed + render multi-year charts ──
async function loadAndShowTrenTahunan() {
  switchStatsView("tahunan");

  // Sudah di-cache dan byNama sudah ada → langsung render ulang
  const firstYear = state.carbonByYear && Object.values(state.carbonByYear)[0];
  if (firstYear && firstYear.byNama) {
    renderMultiYearCharts(state.carbonByYear);
    return;
  }
  state.carbonByYear = {}; // reset jika cache lama (tanpa byNama)

  // Tampilkan loading hint
  const emptyTren = document.getElementById("chart-empty-trend");
  const emptyKelas = document.getElementById("chart-empty-kelas");
  if (emptyTren) {
    emptyTren.style.display = "flex";
    emptyTren.textContent = "⏳ Memuat data semua tahun…";
  }
  if (emptyKelas) {
    emptyKelas.style.display = "flex";
    emptyKelas.textContent = "⏳ Memuat data per kelas…";
  }

  const YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
  state.carbonByYear = {};

  await Promise.all(
    YEARS.map(async (year) => {
      try {
        const resp = await fetch(`db_karbon/${year}_data.json`);
        if (!resp.ok) return;
        const pd = await resp.json();

        let totalCarbon = 0,
          totalAGB = 0,
          totalBGB = 0;
        const byClass = {};

        for (const [codeStr, areaHa] of Object.entries(pd.total || {})) {
          const code = +codeStr;
          const stock = calcStockByClassCode(code, areaHa, "nfi");
          if (!stock || !stock.total) continue;
          byClass[code] = {
            areaHa,
            carbon: stock.total,
            agb: stock.aboveground,
            bgb: stock.belowground,
          };
          totalCarbon += stock.total;
          totalAGB += stock.aboveground;
          totalBGB += stock.belowground;
        }

        // Hitung carbon per nama hutan dari byNama
        const byNama = {};
        for (const [key, nd] of Object.entries(pd.byNama || {})) {
          let carbonNama = 0,
            agbNama = 0,
            bgbNama = 0;
          for (const [codeStr, areaHa] of Object.entries(
            nd.classCounts || {},
          )) {
            const stock = calcStockByClassCode(+codeStr, areaHa, "nfi");
            if (!stock || !stock.total) continue;
            carbonNama += stock.total;
            agbNama += stock.aboveground;
            bgbNama += stock.belowground;
          }
          byNama[key] = {
            nama: nd.namobj,
            kelas: nd.kelas,
            totalArea: nd.shpAreaHa || 0,
            totalCarbon: carbonNama,
            agb: agbNama,
            bgb: bgbNama,
          };
        }

        state.carbonByYear[year] = {
          totalAreaHa: pd.totalShpAreaHa || 0,
          totalCarbon,
          agb: totalAGB,
          bgb: totalBGB,
          co2: totalCarbon * 3.67,
          byClass,
          byNama,
        };
      } catch (_) {
        /* skip tahun yang tidak ada datanya */
      }
    }),
  );

  renderMultiYearCharts(state.carbonByYear);
}

/** Auto-load hutan/hutan shapefile boundary — per fitur, klik untuk hitung karbon */
async function loadNfiShp() {
  if (state.nfiShpPolygon) {
    if (state.mapInstance && !state.nfiShpLayer) {
      _renderNfiShpFeatures(state.nfiShpFeatures || [], state.mapInstance);
    }
    return;
  }
  try {
    if (!window.shp) throw new Error("shpjs not loaded");
    const geojson = await window.shp("hutan/hutan.zip");
    const features = Array.isArray(geojson)
      ? geojson.flatMap((g) => g.features || [g])
      : geojson.features || [geojson];

    const rings = [];
    // Simpan features lengkap dengan atribut
    state.nfiShpFeatures = features;

    features.forEach((feat) => {
      const geom = feat.geometry || feat;
      if (!geom?.coordinates) return;
      if (geom.type === "Polygon") {
        rings.push(geom.coordinates[0]);
      } else if (geom.type === "MultiPolygon") {
        geom.coordinates.forEach((poly) => rings.push(poly[0]));
      }
    });

    if (!rings.length) return;
    state.nfiShpPolygon = rings;

    if (state.mapInstance) {
      if (state.nfiShpLayer) {
        state.nfiShpLayer.remove();
        state.nfiShpLayer = null;
      }
      _renderNfiShpFeatures(features, state.mapInstance);
    }

    // Tampilkan toggle strip bottom-bar (setelah SHP dimuat)
    const toggleStrip = $("bb-toggle-strip");
    const bbtCount = $("bbt-count");
    if (toggleStrip) toggleStrip.style.display = "flex";
    if (bbtCount) bbtCount.textContent = `${features.length} kawasan`;

    const shpRow = $("klhk-shp-row");
    const shpName = $("klhk-shp-name");
    if (shpRow) shpRow.style.display = "flex";
    if (shpName) shpName.textContent = `hutan.shp (${features.length} fitur)`;

    const shpListIpcc = $("shp-file-list");
    if (shpListIpcc && !state.shpPolygon) {
      shpListIpcc.innerHTML = `<div class="file-item">
        <span class="fi-dot" style="background:#52b788"></span>
        <span class="fi-name">hutan.shp</span>
        <span class="fi-size">${features.length} fitur · auto</span>
      </div>`;
    }
    const shpListLit = $("shp-file-list-lit");
    if (shpListLit && !state.litShpPolygon) {
      shpListLit.innerHTML = `<div class="file-item">
        <span class="fi-dot" style="background:#52b788"></span>
        <span class="fi-name">hutan.shp</span>
        <span class="fi-size">${features.length} fitur · auto</span>
      </div>`;
    }

    // Literature: setelah SHP dimuat, zoom dan hitung/render choropleth
    if (state.method === "lefebvre" && state.mapInstance) {
      const allLngs = rings.flat().map(([lng]) => lng);
      const allLats = rings.flat().map(([, lat]) => lat);
      state.mapInstance.fitBounds(
        [
          [Math.min(...allLats), Math.min(...allLngs)],
          [Math.max(...allLats), Math.max(...allLngs)],
        ],
        { padding: [40, 40] },
      );
      if (state.litPrecomputed) {
        // JSON sudah ada (setLitYear selesai sebelum SHP) → hitung sekarang
        await calculate();
      } else if (state._litByNama?.length) {
        // Sudah ada hasil lama → render ulang choropleth dengan SHP baru
        renderLitChoropleth(state._litByNama);
        setMapLayer("namaHutan");
      }
    }
  } catch (err) {
    console.error("Auto-load hutan SHP failed:", err.message, err);
    showKlhkStatus("error", "Gagal memuat SHP: " + err.message);
  }
}

/** Render tiap fitur SHP sebagai polygon Leaflet — klik langsung hitung stok karbon */
function _renderNfiShpFeatures(features, mapInstance) {
  if (state.nfiShpLayer) {
    state.nfiShpLayer.remove();
    state.nfiShpLayer = null;
  }
  // Buat pane khusus dengan z-index tinggi agar SHP selalu di atas raster overlay
  if (!mapInstance.getPane("shpPane")) {
    mapInstance.createPane("shpPane").style.zIndex = 450;
  }
  const group = L.featureGroup().addTo(mapInstance);

  // Buat peta namobj → warna palette untuk layer Nama Hutan
  const namaColorMap = {};
  let _pIdx = 0;
  features.forEach((feat) => {
    const p = feat.properties || {};
    const n = p["NAMOBJ"] || p["namobj"] || p["NamObj"] || "Area Hutan";
    if (!(n in namaColorMap))
      namaColorMap[n] =
        FOREST_NAME_PALETTE[_pIdx++ % FOREST_NAME_PALETTE.length];
  });

  features.forEach((feat) => {
    const geom = feat.geometry || feat;
    const props = feat.properties || {};
    if (!geom?.coordinates) return;

    // Gunakan kolom NAMOBJ sebagai nama utama
    const nama =
      props["NAMOBJ"] ||
      props["namobj"] ||
      props["NamObj"] ||
      Object.keys(props).reduce(
        (v, k) => v || (/nama|name|kawasan|wilayah/i.test(k) ? props[k] : null),
        null,
      ) ||
      "Area Hutan";

    // Konversi koordinat GeoJSON [lng,lat] → Leaflet [lat,lng]
    const toLeaflet = (ring) => ring.map(([lng, lat]) => [lat, lng]);
    let leafletCoords;
    if (geom.type === "Polygon") {
      leafletCoords = geom.coordinates.map(toLeaflet);
    } else if (geom.type === "MultiPolygon") {
      leafletCoords = geom.coordinates.map((poly) => poly.map(toLeaflet));
    } else return;

    const namaColor = namaColorMap[nama] || "#52b788";
    const layer = L.polygon(leafletCoords, {
      color: namaColor,
      weight: 2,
      opacity: 0.75,
      fillOpacity: 0, // border saja, fill transparan agar overlay terlihat
      pane: "shpPane",
    }).addTo(group);

    layer._namaColor = namaColor;

    // Tooltip nama hutan
    layer.bindTooltip(`<strong>${nama}</strong>`, {
      sticky: true,
      className: "shp-tooltip",
    });

    // Klik → langsung hitung dan tampilkan popup hasil (hanya di mode namaHutan)
    layer.on("click", function (e) {
      if (state.activeMapLayer !== "namaHutan") return;
      L.DomEvent.stopPropagation(e);

      // Tampilkan popup loading dulu
      layer
        .bindPopup(
          `
        <div style="min-width:220px;font-family:inherit;text-align:center;padding:8px 0">
          <div style="font-size:13px;font-weight:700;color:#52b788;margin-bottom:8px">🌳 ${nama}</div>
          <div style="font-size:11px;color:#7aa89a">⏳ Menghitung stok karbon...</div>
        </div>
      `,
          { maxWidth: 300 },
        )
        .openPopup(e.latlng);

      // Hitung otomatis
      calcCarbonFromShpFeature(L.stamp(layer));
    });

    // Simpan referensi
    layer._shpProps = props;
    layer._shpNama = nama;
    layer._shpFeature = feat;
  });

  state.nfiShpLayer = group;
  state._shpFeatureMap = {};
  group.eachLayer((l) => {
    if (l._shpProps) state._shpFeatureMap[L.stamp(l)] = l;
  });

  // Simpan namaColorMap ke state agar renderBottomBar bisa pakai warna yang konsisten
  state._namaColorMap = namaColorMap;

  // Terapkan tooltip sesuai mode aktif saat SHP pertama kali dimuat
  if (state.activeMapLayer !== "namaHutan") {
    group.eachLayer((l) => l.unbindTooltip());
  }

  // Render panel nama & kelas hutan
  renderForestNamePanel(features, namaColorMap);
}

// ── FOREST NAME PANEL ─────────────────────────────────────────
function renderForestNamePanel(features, namaColorMap) {
  const panel = $("forest-name-panel");
  const list = $("fnp-list");
  if (!panel || !list) return;

  list.innerHTML = "";
  // Satu baris per namobj unik
  const seen = new Set();
  features.forEach((feat) => {
    const p = feat.properties || {};
    const nama = p["NAMOBJ"] || p["namobj"] || p["NamObj"] || "Area Hutan";
    const kelas = p["kelas"] || p["KELAS"] || p["Kelas"] || p["desc_in"] || "–";
    if (seen.has(nama)) return;
    seen.add(nama);
    const color = namaColorMap[nama] || "#52b788";
    const item = document.createElement("div");
    item.className = "fnp-item";
    item.title = kelas;
    item.innerHTML = `
      <span class="fnp-dot" style="background:${color}"></span>
      <div class="fnp-info">
        <div class="fnp-nama">${nama}</div>
        <div class="fnp-kelas">${kelas}</div>
      </div>
    `;
    list.appendChild(item);
  });

  panel.classList.add("visible");
  // Default: terbuka
  const body = $("fnp-body");
  const icon = $("fnp-toggle");
  if (body) body.classList.remove("collapsed");
  if (icon) icon.classList.remove("collapsed");
}

function toggleForestNamePanel() {
  const body = $("fnp-body");
  const icon = $("fnp-toggle");
  if (!body) return;
  const isCollapsed = body.classList.toggle("collapsed");
  icon?.classList.toggle("collapsed", isCollapsed);
}

// ── BOTTOM BAR TOGGLE ─────────────────────────────────────────
function toggleBottomBar() {
  const bar = $("bottom-bar");
  const arrow = $("bbt-arrow");
  if (!bar) return;
  const isOpen = bar.classList.toggle("visible");
  arrow?.classList.toggle("open", isOpen);
}

/** Hitung stok karbon untuk 1 fitur SHP yang diklik — otomatis, tanpa tombol */
async function calcCarbonFromShpFeature(stampId) {
  const layer = state._shpFeatureMap?.[stampId];
  if (!layer) return;

  const nama = layer._shpNama || "Area";

  if (!state.raster) {
    layer
      .bindPopup(
        `
      <div style="min-width:220px;font-family:inherit">
        <div style="font-size:13px;font-weight:700;color:#52b788;margin-bottom:6px">🌳 ${nama}</div>
        <div style="font-size:11px;color:#e57373">⚠ Pilih tahun data KLHK terlebih dahulu agar raster tersedia.</div>
      </div>
    `,
        { maxWidth: 280 },
      )
      .openPopup();
    return;
  }

  const ll = layer.getLatLngs();
  const ring = (Array.isArray(ll[0][0]) ? ll[0][0] : ll[0]).map((p) => [
    p.lng,
    p.lat,
  ]);

  // Sample raster dalam polygon ini
  const counts = sampleRasterByPolygon(state.raster, [ring]);
  if (!Object.keys(counts).length) {
    layer
      .bindPopup(
        `
      <div style="min-width:220px;font-family:inherit">
        <div style="font-size:13px;font-weight:700;color:#52b788;margin-bottom:6px">🌳 ${nama}</div>
        <div style="font-size:11px;color:#e57373">⚠ Tidak ada pixel raster dalam area ini.</div>
      </div>
    `,
        { maxWidth: 280 },
      )
      .openPopup();
    return;
  }

  // Hitung karbon per kelas
  const avgPxHa = computeAvgPixelAreaHa(state.raster);
  let totalC = 0,
    totalArea = 0;
  const classRows = [];

  for (const [valStr, areaHa] of Object.entries(counts)) {
    const code = findClassCodeByPixelValue(parseFloat(valStr), avgPxHa);
    if (code === null) continue;
    const cl = LANDCOVER_CLASS_VALUES[code];
    if (!cl) continue;
    const cs = calcStockByClassCode(code, areaHa, state.method);
    totalC += cs.total;
    totalArea += areaHa;
    classRows.push(`<tr>
      <td style="padding:2px 8px 2px 0">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;
          background:${cl.color};margin-right:4px"></span>${cl.nameId}
      </td>
      <td style="text-align:right">${areaHa.toFixed(1)} ha</td>
      <td style="text-align:right;color:#52b788;font-weight:600">${fmt(cs.total)} tC</td>
    </tr>`);
  }

  // Tampilkan popup hasil
  layer
    .bindPopup(
      `
    <div style="min-width:240px;font-family:inherit">
      <div style="font-size:13px;font-weight:700;color:#52b788;margin-bottom:8px">🌳 ${nama}</div>
      <table style="font-size:11px;width:100%;border-collapse:collapse">
        <tr style="color:#7aa89a;font-size:10px;border-bottom:1px solid rgba(82,183,136,0.2)">
          <th style="text-align:left;padding-bottom:3px">Tutupan</th>
          <th style="text-align:right">Luas</th>
          <th style="text-align:right">Karbon</th>
        </tr>
        ${classRows.join("")}
      </table>
      <div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(82,183,136,0.3)">
        <div style="font-size:11px;color:#7aa89a">Total Area: <strong style="color:#e2e8f0">${totalArea.toFixed(2)} ha</strong></div>
        <div style="font-size:15px;color:#52b788;font-weight:700;margin-top:3px">
          ${fmt(totalC)} tC
        </div>
        <div style="font-size:10px;color:#7aa89a;margin-top:1px">CO₂eq: ${fmt(totalC * 3.67)} tCO₂</div>
      </div>
    </div>
  `,
      { maxWidth: 300 },
    )
    .openPopup();

  // Warnai polygon berdasarkan densitas stok karbon
  layer._carbonTotal = totalC;
  layer._areaTotal = totalArea;
  _colorShpFeatureByCarbon(layer, totalC, totalArea);
  _updateShpCarbonGradient();
}

// ── CARBON GRADIENT COLORING FOR SHP FEATURES ────────────────
/**
 * Warnai satu polygon SHP berdasarkan densitas karbon (tC/ha)
 * Gradasi: rendah (#d4edda hijau muda) → tinggi (#1a4731 hijau pekat)
 */
function _colorShpFeatureByCarbon(layer, totalC, areaHa) {
  if (!layer || !areaHa) return;
  const density = totalC / areaHa; // tC/ha
  // Skala 0–200 tC/ha → warna hijau muda ke pekat
  const t = Math.max(0, Math.min(1, density / 200));
  // hijau muda rgb(212,237,218) → hijau pekat rgb(26,71,49)
  const r = Math.round(212 + t * (26 - 212));
  const g = Math.round(237 + t * (71 - 237));
  const b = Math.round(218 + t * (49 - 218));
  layer.setStyle({
    fillColor: `rgb(${r},${g},${b})`,
    fillOpacity: 0.65,
    color: "#52b788",
    weight: 1.8,
  });
}

/**
 * Normalisasi warna semua fitur yang sudah dihitung
 * berdasarkan nilai karbon tertinggi di antara mereka
 */
function _updateShpCarbonGradient() {
  if (!state._shpFeatureMap) return;
  const layers = Object.values(state._shpFeatureMap).filter(
    (l) => l._carbonTotal != null,
  );
  if (!layers.length) return;
  const maxDensity = Math.max(
    ...layers.map((l) =>
      l._areaTotal > 0 ? l._carbonTotal / l._areaTotal : 0,
    ),
  );
  if (maxDensity <= 0) return;
  layers.forEach((l) => {
    const density = l._areaTotal > 0 ? l._carbonTotal / l._areaTotal : 0;
    const t = Math.max(0, Math.min(1, density / maxDensity));
    const r = Math.round(212 + t * (26 - 212));
    const g = Math.round(237 + t * (71 - 237));
    const b = Math.round(218 + t * (49 - 218));
    l.setStyle({
      fillColor: `rgb(${r},${g},${b})`,
      fillOpacity: 0.65,
      color: "#52b788",
      weight: 1.8,
    });
  });
  // Refresh legenda jika mode carbon aktif
  if (state.activeMapLayer === "carbon") updateMapLegend("carbon");
}

// ── LITERATURE: Choropleth SHP berdasarkan densitas karbon ────
// Warnai setiap polygon hutan dengan gradien hijau muda→tua
// sesuai densitas karbon (tC/ha) dari JSON pre-computed.
function renderLitChoropleth(byNamaArr) {
  if (!state.nfiShpLayer || !byNamaArr?.length) return;

  // Bangun map: nama → densitas (tC/ha)
  const densityMap = {};
  byNamaArr.forEach((item) => {
    if (item.areaHa > 0) densityMap[item.nama] = item.carbon / item.areaHa;
  });

  const densities = Object.values(densityMap).filter((d) => d > 0);
  if (!densities.length) return;

  const minD = Math.min(...densities);
  const range = Math.max(...densities) - minD || 1;

  // Gradient hijau muda (#c7e8c2) → hijau tua (#1a6b2e)
  function carbonColor(density) {
    const t = Math.max(0, Math.min(1, (density - minD) / range));
    const r = Math.round(199 - t * 173); // 199 → 26
    const g = Math.round(232 - t * 125); // 232 → 107
    const b = Math.round(194 - t * 148); // 194 → 46
    return `rgb(${r},${g},${b})`;
  }

  state.nfiShpLayer.eachLayer((l) => {
    const nama = l._shpNama;
    l._litColor =
      densityMap[nama] !== undefined
        ? carbonColor(densityMap[nama])
        : "#cccccc"; // abu — tidak ada data
  });
}

// ── LITERATURE: Load Stock Carbon Landsat 8 per tahun ────────
// Strategi: coba JSON pre-computed dulu (< 5 KB, instan).
// Jika tidak ada, tampilkan instruksi bahwa data tidak tersedia.
async function setLitYear(year) {
  state.ndviYear = String(year);
  state.year = String(year);

  document.querySelectorAll(".ndvi-yr-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.year === state.ndviYear);
    btn.classList.remove("loading");
  });
  const activeBtn = Array.from(document.querySelectorAll(".ndvi-yr-btn")).find(
    (b) => b.dataset.year === state.ndviYear,
  );
  if (activeBtn) activeBtn.classList.add("loading");

  showNdviStatus("loading", `Memuat data tahun ${year}...`);
  // Hapus overlay lama jika ada
  if (state.carbonStockLayer && state.mapInstance) {
    state.mapInstance.removeLayer(state.carbonStockLayer);
    state.carbonStockLayer = null;
  }
  $("ndvi-raster-info").style.display = "none";

  showLoader(`Memuat Stok Karbon ${year}...`);

  const jsonUrl = `/Karbon_Literature/karbon_lit_${year}.json`;

  try {
    // ── Coba JSON pre-computed dulu (< 5 KB, instan) ──────────
    let hasJson = false;
    try {
      const resp = await fetch(jsonUrl);
      if (resp.ok) {
        state.litPrecomputed = await resp.json();
        hasJson = true;
      }
    } catch (_) {
      /* JSON belum ada, akan load TIF */
    }

    if (hasJson) {
      showNdviStatus(
        "ok",
        `Stok Karbon ${year} ✓ · JSON pre-computed · Landsat 8 30m`,
      );
      const infoEl = $("ndvi-raster-info");
      if (infoEl) {
        infoEl.innerHTML = `<span class="crs-badge">Data pre-computed · Landsat 8 · 30m · UTM 48S</span>`;
        infoEl.style.display = "block";
      }
      if (activeBtn) activeBtn.classList.remove("loading");
      toggleCalcBtn();

      // Fit bounds ke SHP hutan
      if (state.mapInstance && state.nfiShpPolygon?.length) {
        const allLngs = state.nfiShpPolygon.flat().map(([lng]) => lng);
        const allLats = state.nfiShpPolygon.flat().map(([, lat]) => lat);
        state.mapInstance.fitBounds(
          [
            [Math.min(...allLats), Math.min(...allLngs)],
            [Math.max(...allLats), Math.max(...allLngs)],
          ],
          { padding: [40, 40] },
        );
        const ltg = $("layer-toggle-group");
        if (ltg) ltg.style.display = "flex";
      }

      // Auto-hitung instan dari JSON (jika SHP sudah tersedia)
      if (state.nfiShpFeatures?.length) {
        await calculate();
        // Choropleth sudah dirender di dalam calculate() — zoom peta
        if (state.mapInstance && state.nfiShpPolygon?.length) {
          const allLngs = state.nfiShpPolygon.flat().map(([lng]) => lng);
          const allLats = state.nfiShpPolygon.flat().map(([, lat]) => lat);
          state.mapInstance.fitBounds(
            [
              [Math.min(...allLats), Math.min(...allLngs)],
              [Math.max(...allLats), Math.max(...allLngs)],
            ],
            { padding: [40, 40] },
          );
        }
      }
      // SHP belum selesai load → callback di loadNfiShp akan trigger calculate()
    } else {
      // JSON belum di-generate — jangan load TIF (17 MB, bekukan browser)
      if (activeBtn) {
        activeBtn.classList.remove("loading");
        activeBtn.classList.remove("active");
      }
      showNdviStatus(
        "error",
        `⚠ Data JSON belum tersedia untuk tahun ${year}.`,
      );
      toggleCalcBtn();
    }
  } catch (err) {
    if (activeBtn) {
      activeBtn.classList.remove("loading");
      activeBtn.classList.remove("active");
    }
    const is404 =
      err.message.includes("HTTP 404") ||
      err.message.includes("Failed to fetch");
    if (is404) {
      if (activeBtn) activeBtn.classList.add("yr-na");
      showNdviStatus(
        "error",
        `Data karbon ${year} tidak tersedia.`,
      );
    } else {
      showNdviStatus("error", err.message);
    }
    state.carbonStockRaster = null;
    state.litPrecomputed = null;
    toggleCalcBtn();
  } finally {
    hideLoader();
  }
}

function showNdviStatus(type, msg) {
  const row = $("ndvi-status-row");
  const icon = $("ndvi-status-icon");
  const text = $("ndvi-status-text");
  if (!row) return;
  row.style.display = "flex";
  if (icon) {
    icon.className = `klhk-status-icon ${type}`;
    icon.textContent = type === "loading" ? "⟳" : type === "ok" ? "✓" : "✗";
  }
  if (text) text.textContent = msg;
}

async function loadIpccDem() {
  if (state.demRaster) {
    // Already loaded — just auto-calculate
    if (state.method === "ipcc") calculate();
    return;
  }
  const demList = $("dem-file-list");
  if (demList) {
    demList.innerHTML = `<div class="file-item">
      <span class="fi-dot" style="background:#1b5e20"></span>
      <span class="fi-name">elevasi.tif</span>
      <span class="fi-size" id="dem-auto-size">memuat...</span>
    </div>`;
  }
  try {
    state.demRaster = await loadGeoTiffFromUrl(
      "assets/elevasi.tif",
      "elevasi.tif",
    );
    // Tandai sebagai DEM; handle nodata value yang besar (float32 -3.4e38)
    state.demRaster.isDEM = true;
    // nodata dari elevasi.tif adalah -3.4028230607370965e+38
    if (state.demRaster.nodata === 255 || state.demRaster.nodata === -9999) {
      state.demRaster.nodata = -3.4028230607370965e38;
    }
    const { width, height, crs } = state.demRaster;
    const sizeEl = $("dem-auto-size");
    if (sizeEl)
      sizeEl.textContent = `${width}×${height}px · ${crs?.type === "utm" ? "UTM" : "WGS84"}`;
    toggleCalcBtn();
    if (state.method === "ipcc") calculate();
  } catch (err) {
    console.warn("Auto-load DEM failed:", err.message);
    if (demList)
      demList.innerHTML = `<div style="color:var(--danger);font-size:11px;padding:4px 0">⚠ DEM tidak dapat dimuat. Upload manual.</div>`;
  }
}

// ── CALCULATE ────────────────────────────────────────────────
async function calculate() {
  const hasDrawn = state.drawnPolygons.length > 0;
  const isIpcc = state.method === "ipcc";
  const isLit = state.method === "lefebvre";

  // ── Validation ────────────────────────────────────────────
  if (isIpcc) {
    if (!state.demRaster) {
      showError("⚠ Upload file DEM terlebih dahulu untuk metode IPCC.");
      return;
    }
  } else if (!isLit) {
    if (!state.raster) {
      showError("⚠ Pilih tahun data LULC terlebih dahulu.");
      return;
    }
  }
  showError("");

  const btn = $("calc-btn");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${t("btnCalcing")}`;

  showLoader("Sedang Menghitung...");

  // Use setTimeout to allow the browser to paint the loader UI before the heavy processing freezes the main thread
  setTimeout(async () => {
    try {
      const classData = {};
      let agg = { aboveground: 0, belowground: 0, total: 0 };
      let totalAreaHa = 0;

      // Clear previous dual layers
      if (state.coverLayer) {
        state.coverLayer.remove();
        state.coverLayer = null;
      }
      if (state.carbonLayer) {
        state.carbonLayer.remove();
        state.carbonLayer = null;
      }

      if (isIpcc) {
        // ── IPCC: classify by DEM elevation ───────────────────
        if (state.mapInstance) {
          const clipRings = state.nfiShpPolygon?.length
            ? state.nfiShpPolygon
            : state.shpPolygon?.length
              ? state.shpPolygon
              : null;
          state.coverLayer = await addDemOverlayToMap(
            state.demRaster,
            state.mapInstance,
            IPCC_ELEV_THRESHOLD,
            clipRings,
          );
          state.mapInstance.fitBounds(getRasterBounds(state.demRaster), {
            padding: [30, 30],
          });
        }

        // Kirim SEMUA ring SHP (bukan hanya [0]) agar seluruh kawasan terhitung
        let demPolygons = null;
        if (state.shpPolygon?.length) {
          demPolygons = state.shpPolygon; // array of all rings
        } else if (state.nfiShpPolygon?.length) {
          demPolygons = state.nfiShpPolygon; // semua 50 ring dari hutan.shp
        } else if (hasDrawn) {
          demPolygons = state.drawnPolygons.map((p) =>
            p.points.map(([lat, lng]) => [lng, lat]),
          );
        }

        const { lowland, highland } = await classifyDemByElevation(
          state.demRaster,
          IPCC_ELEV_THRESHOLD,
          demPolygons,
        );
        const ipccCounts = {};
        if (lowland > 0) ipccCounts["tropical_rainforest"] = lowland;
        if (highland > 0) ipccCounts["tropical_mountain"] = highland;

        for (const [key, areaHa] of Object.entries(ipccCounts)) {
          const ft = IPCC_FOREST_TYPES[key];
          const cf = 0.47; // Carbon Fraction — IPCC 2006 Table 4.3
          const biomass = (ft.agb + ft.bgb) * areaHa; // total biomassa [Mg]
          const above = ft.agb * areaHa * cf; // AGB carbon [tC]
          const below = ft.bgb * areaHa * cf; // BGB carbon [tC]
          const total = above + below; // total karbon [tC]
          classData[key] = {
            name: ft.name,
            nameId: ft.nameId,
            areaHa,
            agb_total: above,
            bgb_total: below,
            biomass_total: biomass,
            carbon: total,
            co2: total * CO2_FACTOR,
          };
          agg.aboveground += above;
          agg.belowground += below;
          agg.total += total;
          totalAreaHa += areaHa;
        }
      } else if (isLit) {
        // ── Literature: Stock Carbon Landsat 8 (JSON pre-computed) ─
        if (!state.litPrecomputed) {
          showError(
            "⚠ Pilih tahun data Stok Karbon terlebih dahulu (2015–2025).",
          );
          restoreBtn();
          hideLoader();
          return;
        }
        if (!state.nfiShpFeatures?.length) {
          showError(
            "⚠ Data hutan.shp belum tersedia. Pastikan file SHP sudah ter-load.",
          );
          restoreBtn();
          hideLoader();
          return;
        }

        const pd = state.litPrecomputed;
        const litTotalCarbon = pd.totalCarbon;
        const litAreaHa = pd.totalAreaHa;

        // Bangun byNama dengan warna palette dari nfiShpFeatures
        const byNama = Object.values(pd.byNama).map((v) => {
          const feat = state.nfiShpFeatures.find(
            (f) => (f.properties?.namobj || f.properties?.NAMOBJ) === v.namobj,
          );
          return {
            nama: v.namobj,
            color: feat?._namaColor || "#4caf50",
            carbon: v.carbon,
            areaHa: v.areaHa,
          };
        });

        totalAreaHa = litAreaHa;
        agg.total = litTotalCarbon;
        agg.aboveground = litTotalCarbon;

        // Bangun classData per nama hutan
        for (const item of byNama) {
          if (item.areaHa <= 0) continue;
          classData[item.nama] = {
            name: item.nama,
            nameId: item.nama,
            areaHa: item.areaHa,
            agb_total: item.carbon,
            bgb_total: 0,
            biomass_total: 0,
            carbon: item.carbon,
            co2: item.carbon * CO2_FACTOR,
            color: item.color,
          };
        }
        state._litByNama = byNama;

        // Populate forestCarbonData untuk bottom bar (format sama dengan KLHK)
        state.forestCarbonData = Object.values(pd.byNama)
          .filter((v) => v.carbon > 0)
          .map((v) => ({
            nama: v.namobj,
            kelas: v.kelas,
            totalCarbon: v.carbon,
            totalArea: v.areaHa,
          }))
          .sort((a, b) => b.totalCarbon - a.totalCarbon);

        // Render choropleth SHP berdasarkan densitas karbon (instan)
        renderLitChoropleth(byNama);
        if (state.mapInstance && state.nfiShpLayer) setMapLayer("namaHutan");
      } else {
        // ── KLHK: MapBiomas pre-loaded raster ─────────────────
        // Recreate overlay (always — map display)
        if (state.mapInstance) {
          state.coverLayer = await addRasterOverlayToMap(
            state.raster,
            state.mapInstance,
          );
          state.mapInstance.fitBounds(getRasterBounds(state.raster), {
            padding: [30, 30],
          });
        }

        // ── Prioritas 1: data pre-computed (dari precompute.py) ──────────────
        let _fromPrecomputed = false;
        if (!hasDrawn && state.klhkPrecomputed && state.nfiShpFeatures?.length) {
          const pd = state.klhkPrecomputed;
          const avgPxHa = computeAvgPixelAreaHa(state.raster);

          // Build classData dari pd.total
          const classedCounts = {};
          for (const [valStr, areaHa] of Object.entries(pd.total)) {
            const code = findClassCodeByPixelValue(parseFloat(valStr), avgPxHa);
            if (code === null) continue;
            classedCounts[code] = (classedCounts[code] || 0) + areaHa;
          }
          for (const [codeStr, areaHa] of Object.entries(classedCounts)) {
            const code = parseInt(codeStr, 10);
            const cl = LANDCOVER_CLASS_VALUES[code];
            if (!cl) continue;
            const cs = calcStockByClassCode(code, areaHa, state.method);
            classData[code] = {
              name: cl.name,
              nameId: cl.nameId,
              areaHa,
              agb_total: cs.aboveground,
              bgb_total: cs.belowground,
              agb_dm: cl.agb * areaHa,
              bgb_dm: cl.bgb * areaHa,
              biomass_total: (cl.agb + cl.bgb) * areaHa,
              carbon: cs.total,
              co2: cs.co2Equivalent,
            };
            agg.aboveground += cs.aboveground;
            agg.belowground += cs.belowground;
            agg.total += cs.total;
            totalAreaHa += areaHa;
          }

          // Gunakan luas SHP (UTM 48S shoelace) untuk total area yang akurat
          if (pd.totalShpAreaHa) totalAreaHa = pd.totalShpAreaHa;

          // Build forestCarbonData dari pd.byNama (key = "namobj||kelas")
          const fcd = [];
          for (const [, entry] of Object.entries(pd.byNama)) {
            const nama = entry.namobj; // compound key dipisah, namobj tersimpan di value
            let namaTotalCarbon = 0,
              namaTotalArea = 0;
            for (const [valStr, areaHa] of Object.entries(entry.classCounts)) {
              const code = findClassCodeByPixelValue(parseFloat(valStr), avgPxHa);
              if (code === null) continue;
              const cs = calcStockByClassCode(code, areaHa, state.method);
              namaTotalCarbon += cs.total;
              namaTotalArea += areaHa;
            }
            // Gunakan luas SHP per polygon jika tersedia (lebih akurat dari pixel count)
            const displayArea =
              entry.shpAreaHa > 0 ? entry.shpAreaHa : namaTotalArea;
            if (namaTotalArea > 0) {
              fcd.push({
                nama,
                kelas: entry.kelas,
                totalCarbon: namaTotalCarbon,
                totalArea: displayArea,
              });
            }
          }
          fcd.sort((a, b) => b.totalCarbon - a.totalCarbon);
          state.forestCarbonData = fcd;
          _fromPrecomputed = true;
        }

        // ── Prioritas 2: localStorage cache ──────────────────────────────────
        const _cacheKey =
          !hasDrawn && !_fromPrecomputed && state.klhkYear
            ? `cp_klhk_${state.klhkYear}`
            : null;
        let _fromCache = false;
        if (_cacheKey) {
          try {
            const raw = localStorage.getItem(_cacheKey);
            if (raw) {
              const cd = JSON.parse(raw);
              if (cd?.classData && Array.isArray(cd.forestCarbonData)) {
                Object.assign(classData, cd.classData);
                totalAreaHa = cd.totalAreaHa || 0;
                if (cd.agg) Object.assign(agg, cd.agg);
                state.forestCarbonData = cd.forestCarbonData;
                _fromCache = true;
              }
            }
          } catch (_) {
            /* ignore */
          }
        }

        if (!_fromPrecomputed && !_fromCache) {
          // Determine area: drawn polygon → nfi SHP features → full raster
          let nfiCounts = {};
          let _byNamaCounts = null;
          if (hasDrawn) {
            const drawnRings = state.drawnPolygons.map((p) =>
              p.points.map(([lat, lng]) => [lng, lat]),
            );
            nfiCounts = await sampleRasterByRings(state.raster, drawnRings);
          } else if (state.nfiShpFeatures?.length) {
            // Satu pass untuk semua fitur — sekaligus dapat data per namobj
            const sampResult = await sampleRasterByFeatures(
              state.raster,
              state.nfiShpFeatures,
            );
            nfiCounts = sampResult.total;
            _byNamaCounts = sampResult.byNama;
          } else {
            nfiCounts = sampleFullRaster(state.raster);
          }

          // Formula KLHK:
          // Step 1: biomass_total [Mg/ha] = AGB [Mg/ha] + BGB [Mg/ha]
          // Step 2: areaHa = Σ pixel area [ha]
          // Step 3: carbon [tC] = biomass_total × areaHa × 0.47
          const avgPxHa = computeAvgPixelAreaHa(state.raster);
          const classedCounts = {};
          for (const [valStr, areaHa] of Object.entries(nfiCounts)) {
            const code = findClassCodeByPixelValue(parseFloat(valStr), avgPxHa);
            if (code === null) continue;
            classedCounts[code] = (classedCounts[code] || 0) + areaHa;
          }

          for (const [codeStr, areaHa] of Object.entries(classedCounts)) {
            const code = parseInt(codeStr, 10);
            const cl = LANDCOVER_CLASS_VALUES[code];
            if (!cl) continue;
            const cs = calcStockByClassCode(code, areaHa, state.method);
            classData[code] = {
              name: cl.name,
              nameId: cl.nameId,
              areaHa,
              agb_total: cs.aboveground,
              bgb_total: cs.belowground,
              agb_dm: cl.agb * areaHa,
              bgb_dm: cl.bgb * areaHa,
              biomass_total: (cl.agb + cl.bgb) * areaHa,
              carbon: cs.total,
              co2: cs.co2Equivalent,
            };
            agg.aboveground += cs.aboveground;
            agg.belowground += cs.belowground;
            agg.total += cs.total;
            totalAreaHa += areaHa;
          }

          // Hitung stok karbon per namobj (dari _byNamaCounts, key = "namobj||kelas")
          if (_byNamaCounts) {
            const fcd = [];
            for (const [, entry] of Object.entries(_byNamaCounts)) {
              const nama = entry.namobj; // namobj tersimpan di value, bukan di compound key
              let namaTotalCarbon = 0,
                namaTotalArea = 0;
              for (const [valStr, areaHa] of Object.entries(entry.classCounts)) {
                const code = findClassCodeByPixelValue(
                  parseFloat(valStr),
                  avgPxHa,
                );
                if (code === null) continue;
                const cs = calcStockByClassCode(code, areaHa, state.method);
                namaTotalCarbon += cs.total;
                namaTotalArea += areaHa;
              }
              if (namaTotalArea > 0) {
                fcd.push({
                  nama,
                  kelas: entry.kelas,
                  totalCarbon: namaTotalCarbon,
                  totalArea: namaTotalArea,
                });
              }
            }
            fcd.sort((a, b) => b.totalCarbon - a.totalCarbon);
            state.forestCarbonData = fcd;
          }

          // Simpan ke localStorage cache untuk sesi berikutnya
          if (_cacheKey && state.forestCarbonData?.length) {
            try {
              localStorage.setItem(
                _cacheKey,
                JSON.stringify({
                  classData,
                  totalAreaHa,
                  agg: {
                    aboveground: agg.aboveground,
                    belowground: agg.belowground,
                    total: agg.total,
                  },
                  forestCarbonData: state.forestCarbonData,
                }),
              );
            } catch (_) {
              /* ignore quota exceeded */
            }
          }
        }
      }

      agg.co2Equivalent = agg.total * CO2_FACTOR;

      state.classData = classData;
      state.totalArea = totalAreaHa;
      state.stock = agg;

      // ── Build carbon density layer (IPCC and KLHK) ─────────
      if (state.mapInstance && Object.keys(classData).length > 0) {
        if (isIpcc) {
          const ipccClipRings = state.nfiShpPolygon?.length
            ? state.nfiShpPolygon
            : state.shpPolygon?.length
              ? state.shpPolygon
              : null;
          state.carbonLayer = await addIpccCarbonOverlay(
            state.demRaster,
            classData,
            IPCC_ELEV_THRESHOLD,
            state.mapInstance,
            ipccClipRings,
          );
        } else if (!isLit && state.raster) {
          state.carbonLayer = await addCarbonDensityOverlay(
            state.raster,
            classData,
            state.mapInstance,
          );
        }
      }

      // Show layer toggle
      const ltg = $("layer-toggle-group");
      if (ltg) ltg.style.display = "flex";
      // Literature: choropleth sudah diset di blok isLit — jangan override ke cover
      if (!isLit) setMapLayer("cover");
      // SHP layer selalu tampil di atas raster overlay
      if (state.nfiShpLayer) state.nfiShpLayer.bringToFront();

      // ── Render ─────────────────────────────────────────────
      renderResult(totalAreaHa, agg);
      renderClassBreakdown(classData);
      renderLegend();
      updateMapLegend(state.activeMapLayer);
      updateStatus();

      tx("ks-total-area", fmtDec(totalAreaHa) + " ha");
      tx("ks-carbon-protect", fmt(agg.total) + " tC");
      tx("ks-species", "~" + Math.round(totalAreaHa * 0.012) + " spp");

      renderCharts(classData);
      renderRightPanel(classData, agg, state.method);
      // Literature: rp-total-area pakai totalAreaHa dari JSON (full raster),
      // bukan sum classData per-polygon (lebih kecil karena ada celah antar polygon)
      if (isLit) {
        const rpArea = $("rp-total-area");
        if (rpArea) rpArea.textContent = fmtArea(totalAreaHa);
      }

      // Bottom bar per-hutan hanya di namaHutan mode (ditangani setMapLayer)

      const dominant = Object.entries(classData).sort(
        (a, b) => b[1].carbon - a[1].carbon,
      )[0];
      const domName = dominant ? dominant[1].nameId || dominant[1].name : "–";
      const methLabels = {
        ipcc: "IPCC 2019",
        nfi: "KLHK",
        lefebvre: "Literature",
      };
      updateStatsSummary(
        totalAreaHa,
        agg.total,
        agg.co2Equivalent,
        domName,
        methLabels[state.method],
      );

      window._reportData = {
        areaHa: totalAreaHa,
        stock: agg,
        method: state.method,
        year: state.year,
        classData,
      };
      $("result-panel").classList.add("visible");
    } catch (err) {
      console.error(err);
      showError(t("errParse") + " — " + err.message);
    } finally {
      restoreBtn();
      hideLoader();
    }
  }, 50);
}

function restoreBtn() {
  const btn = $("calc-btn");
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = t("btnCalc");
  }
}

// ── BOTTOM BAR: per-forest carbon ────────────────────────────
function renderBottomBar(forestData) {
  const bar = $("bottom-bar");
  const list = $("bb-forest-list");
  const emptyMsg = $("bb-empty-msg");
  if (!bar) return;

  if (!forestData?.length) {
    bar.classList.remove("visible");
    return;
  }

  bar.classList.add("visible");
  // Sinkronkan panah toggle strip
  $("bbt-arrow")?.classList.add("open");
  if (emptyMsg) emptyMsg.style.display = "none";

  if (list) {
    list.innerHTML = "";
    forestData.forEach((d, i) => {
      // Gunakan warna yang sama dengan peta (dari namaColorMap)
      const color =
        (state._namaColorMap && state._namaColorMap[d.nama]) ||
        FOREST_NAME_PALETTE[i % FOREST_NAME_PALETTE.length];
      const card = document.createElement("div");
      card.className = "bb-forest-card";
      card.style.borderLeftColor = color;
      card.innerHTML = `
        <div class="bb-fc-name" title="${d.nama}">${d.nama}</div>
        <div style="font-size:9px;color:var(--text-sub);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${d.kelas}</div>
        <div class="bb-fc-carbon">${d.totalCarbon >= 1 ? fmt(d.totalCarbon) : d.totalCarbon.toFixed(2)} tC</div>
        <div style="font-size:9px;color:var(--text-sub)">${fmtDec(d.totalArea)} ha</div>
      `;
      list.appendChild(card);
    });
  }

  // Donut chart per kelas hutan
  const byKelas = {};
  forestData.forEach((d) => {
    byKelas[d.kelas] = (byKelas[d.kelas] || 0) + d.totalCarbon;
  });
  renderForestDonutChart(byKelas);
}

// ── RENDER RESULT ────────────────────────────────────────────
function renderResult(areaHa, stock) {
  tx("res-area", fmtArea(areaHa || 0));
  tx("res-stock", fmt(stock.total));
  tx("res-co2", fmt(stock.co2Equivalent));
  tx("res-above", fmt(stock.aboveground) + " tC");
  tx("res-below", fmt(stock.belowground) + " tC");

  const labels = { ipcc: "IPCC 2019", nfi: "KLHK", lefebvre: "Literature" };
  const badge = $("res-method-badge");
  if (badge) badge.textContent = labels[state.method] || "IPCC 2019";

  // Update quick stats
  updateQuickStats(areaHa, stock, state.classData);
}

function renderClassBreakdown(classData) {
  const card = $("class-breakdown-card");
  const list = $("class-breakdown-list");
  if (!card || !list) return;
  list.innerHTML = "";
  const entries = Object.entries(classData).sort(
    (a, b) => b[1].carbon - a[1].carbon,
  );
  if (!entries.length) {
    card.style.display = "none";
    return;
  }
  card.style.display = "block";
  entries.forEach(([code, d]) => {
    const cl =
      LANDCOVER_CLASS_VALUES[code] ??
      IPCC_FOREST_TYPES[code] ??
      NDVI_CARBON_CLASSES[code];
    const div = document.createElement("div");
    div.className = "class-row";
    div.innerHTML = `
      <span class="class-dot" style="background:${cl?.color || "#888"}"></span>
      <span class="class-name">${_lang === "id" ? cl?.nameId || d.name : d.name}</span>
      <span class="class-area">${fmtDec(d.areaHa, 1)} ha</span>
      <span class="class-carbon">${fmt(d.carbon)} tC</span>
    `;
    list.appendChild(div);
  });
}

function renderCharts(classData) {
  renderCarbonChart(classData);
  renderKomparasiChart(classData);
  renderStatsTable(classData);
}

// ── RESET ───────────────────────────────────────────────────
function resetAll() {
  state.drawnPolygons = [];
  // Keep state.raster (KLHK MapBiomas — stays loaded until year changes)
  state.classData = {};
  state.totalArea = 0;
  state.stock = null;
  state.isDrawing = false;
  window._reportData = null;

  if (state.drawnItems) state.drawnItems.clearLayers();
  if (state.coverLayer) {
    state.coverLayer.remove();
    state.coverLayer = null;
  }
  if (state.carbonLayer) {
    state.carbonLayer.remove();
    state.carbonLayer = null;
  }
  const ltg = $("layer-toggle-group");
  if (ltg) ltg.style.display = "none";
  state.activeMapLayer = "cover";

  // IPCC state
  if (state.shpLayer) {
    state.shpLayer.remove();
    state.shpLayer = null;
  }
  state.demFile = null;
  state.demRaster = null;
  state.shpFile = null;
  state.shpPolygon = null;
  ih("shp-file-list", "");
  ih("dem-file-list", "");
  const shpIn = $("shp-input");
  if (shpIn) shpIn.value = "";
  const demIn = $("dem-input");
  if (demIn) demIn.value = "";

  // Literature state
  if (state.litShpLayer) {
    state.litShpLayer.remove();
    state.litShpLayer = null;
  }
  state.carbonStockRaster = null;
  state.litPrecomputed = null;
  state._litByNama = null;
  state.litShpFile = null;
  state.litShpPolygon = null;
  state.ndviYear = null;
  ih("shp-file-list-lit", "");
  const shpInLit = $("shp-input-lit");
  if (shpInLit) shpInLit.value = "";
  // Reset NDVI year buttons
  document
    .querySelectorAll(".ndvi-yr-btn")
    .forEach((b) => b.classList.remove("active"));
  const ndviStatusRow = $("ndvi-status-row");
  if (ndviStatusRow) ndviStatusRow.style.display = "none";
  const ndviInfo = $("ndvi-raster-info");
  if (ndviInfo) {
    ndviInfo.innerHTML = "";
    ndviInfo.style.display = "none";
  }

  // KLHK: keep raster, klhkYear, nfiShpPolygon, nfiShpLayer across resets
  $("result-panel").classList.remove("visible");
  $("tool-draw")?.classList.remove("active");
  $("draw-hint")?.classList.remove("visible");
  const ri = $("raster-info");
  if (ri) ri.style.display = "none";

  showError("");
  updateStatus();
  toggleCalcBtn();
  renderLegend();

  // Reset right panel
  ih(
    "rp-class-list",
    '<div class="rp-empty">Belum ada data.<br>Hitung terlebih dahulu.</div>',
  );
  tx("rp-total-area", "–");
  tx("rp-total-carbon", "–");
  const rpEmpty = $("rp-chart-empty");
  if (rpEmpty) rpEmpty.style.display = "flex";
  if (typeof _chartDonut !== "undefined" && _chartDonut) {
    _chartDonut.destroy();
    _chartDonut = null;
  }
}

// ── STATUS ───────────────────────────────────────────────────
function updateStatus() {
  const area = state.drawnPolygons.reduce((s, p) => s + p.area, 0);
  tx("st-area", area > 0 ? fmtArea(area) : "0 ha");
}

function updateQuickStats(areaHa, stock, classData) {
  // Update the quick stats panel that appears on the map
  tx("qs-area", fmtDec(areaHa || 0, 1));
  tx("qs-carbon", fmt(stock.total || 0));
  tx("qs-emission", fmt(stock.co2Equivalent || 0));

  // Find dominant class
  if (classData && Object.keys(classData).length > 0) {
    const dominant = Object.entries(classData).sort(
      (a, b) => b[1].carbon - a[1].carbon,
    )[0];
    if (dominant) {
      const domName =
        _lang === "id"
          ? dominant[1].nameId || dominant[1].name
          : dominant[1].name;
      tx("qs-class", domName || "–");
    }
  }
}

function toggleCalcBtn() {
  const btn = $("calc-btn");
  if (!btn) return;
  if (state.method === "ipcc") {
    btn.disabled = !state.demRaster;
  } else if (state.method === "lefebvre") {
    // Literature: butuh NDVI raster sudah dimuat (year dipilih)
    btn.disabled = !state.ndviRaster;
  } else {
    // KLHK: need a raster loaded (year selected)
    btn.disabled = !state.raster;
  }
}

function showError(msg) {
  const el = $("error-box");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("visible", !!msg);
}

// ── RIGHT PANEL TOGGLE ───────────────────────────────────────
function toggleRightPanel() {
  const panel = $("right-panel");
  const btn = $("rp-toggle-btn");
  if (!panel) return;
  panel.classList.toggle("collapsed");
  if (btn) btn.textContent = panel.classList.contains("collapsed") ? "‹" : "›";
  setTimeout(() => {
    if (state.mapInstance) state.mapInstance.invalidateSize();
  }, 300);
}

// ── CONSERVATION & RESTORATION CLASSIFICATION ─────────────────

/**
 * Calculate and render conservation classification on map2
 * Uses carbonByYear data to determine trends and classify forests
 */
async function calculateConservationClassification() {
  // Check if we have multi-year data
  if (!state.carbonByYear || Object.keys(state.carbonByYear).length < 2) {
    // Need to load multi-year data first
    await loadAndShowTrenTahunan();
  }

  if (!state.carbonByYear || Object.keys(state.carbonByYear).length < 2) {
    console.warn("Insufficient data for classification");
    return null;
  }

  // Calculate classification for all forests
  const classification = calculateAllClassifications(state.carbonByYear);
  state.conservationClassification = classification;

  return classification;
}

/**
 * Render conservation classification on map2
 * Colors polygons based on their classification category
 */
function renderConservationMap(classificationResults) {
  if (!state.map2Instance || !state.nfiShpLayer) return;

  // Create a map of forest names to their classification
  const classMap = {};
  classificationResults.forEach((c) => {
    classMap[c.nama] = c;
  });

  // Update polygon colors based on classification
  state.nfiShpLayer.eachLayer((layer) => {
    const nama = layer._shpNama;
    const classification = classMap[nama];

    if (classification) {
      const color = classification.category.color;
      layer.setStyle({
        fillColor: color,
        fillOpacity: 0.65,
        color: "#333",
        weight: 1.5,
      });
      layer._classification = classification;
    }
  });

  // Update the legend
  renderConservationLegend(classificationResults);

  // Update stats panel
  updateConservationStats(classificationResults);
}

/**
 * Render the conservation classification legend
 */
function renderConservationLegend(classificationResults) {
  const legend = $("legend-list2");
  if (!legend) return;

  // Count forests per category
  const counts = {
    konservasi_prioritas_tinggi: 0,
    konservasi_dengan_pemantauan: 0,
    restorasi_aktif: 0,
    waspada_transisi: 0,
  };

  classificationResults.forEach((c) => {
    counts[c.category.id]++;
  });

  const categories = [
    {
      id: "konservasi_prioritas_tinggi",
      name: "Konservasi Prioritas Tinggi",
      color: "#0d9488",
      count: counts.konservasi_prioritas_tinggi,
    },
    {
      id: "konservasi_dengan_pemantauan",
      name: "Konservasi dengan Pemantauan",
      color: "#52b788",
      count: counts.konservasi_dengan_pemantauan,
    },
    {
      id: "restorasi_aktif",
      name: "Restorasi Aktif",
      color: "#e07a5f",
      count: counts.restorasi_aktif,
    },
    {
      id: "waspada_transisi",
      name: "Waspada/Transisi",
      color: "#f2cc8f",
      count: counts.waspada_transisi,
    },
  ];

  legend.innerHTML = categories
    .map(
      (cat) => `
    <div class="legend-item">
      <span class="li-dot" style="background: ${cat.color}"></span>
      ${cat.name} (${cat.count})
    </div>
  `,
    )
    .join("");
}

/**
 * Update conservation stats panel
 */
function updateConservationStats(classificationResults) {
  const totalForests = classificationResults.length;

  // Calculate totals per category
  const byCategory = {
    konservasi_prioritas_tinggi: { count: 0, area: 0, carbon: 0 },
    konservasi_dengan_pemantauan: { count: 0, area: 0, carbon: 0 },
    restorasi_aktif: { count: 0, area: 0, carbon: 0 },
    waspada_transisi: { count: 0, area: 0, carbon: 0 },
  };

  classificationResults.forEach((c) => {
    const cat = c.category.id;
    byCategory[cat].count++;
    byCategory[cat].area += c.totalArea || 0;
    byCategory[cat].carbon += c.currentStock || 0;
  });

  // Update the stats panel
  tx("ks-total-area", fmtDec(state.totalArea) + " ha");
  tx(
    "ks-carbon-protect",
    fmt(
      byCategory.konservasi_prioritas_tinggi.carbon +
      byCategory.konservasi_dengan_pemantauan.carbon,
    ) + " tC",
  );
  tx("ks-species", "~" + Math.round(state.totalArea * 0.012) + " spp");
}

/**
 * Show classification details in popup when polygon is clicked
 */
function showClassificationPopup(layer, e) {
  const classification = layer._classification;
  if (!classification) return;

  const c = classification;
  const content = `
    <div style="min-width:280px;font-family:inherit">
      <div style="font-size:14px;font-weight:700;color:${c.category.color};margin-bottom:8px">
        ${c.category.name}
      </div>
      <div style="font-size:12px;margin-bottom:6px">🌳 ${c.nama}</div>
      <div style="font-size:11px;color:#666;margin-bottom:10px">${c.category.description}</div>
      
      <table style="font-size:11px;width:100%;border-collapse:collapse">
        <tr style="border-bottom:1px solid #eee">
          <td style="padding:3px 0;color:#888">Tren</td>
          <td style="text-align:right;font-weight:600">${c.trend}</td>
        </tr>
        <tr style="border-bottom:1px solid #eee">
          <td style="padding:3px 0;color:#888">Konsistensi (R²)</td>
          <td style="text-align:right">${c.r2.toFixed(2)} (${c.consistency})</td>
        </tr>
        <tr style="border-bottom:1px solid #eee">
          <td style="padding:3px 0;color:#888">Perubahan/tahun</td>
          <td style="text-align:right">${c.slope >= 0 ? "+" : ""}${fmt(c.slope)} tC</td>
        </tr>
        <tr style="border-bottom:1px solid #eee">
          <td style="padding:3px 0;color:#888">Stok 2024</td>
          <td style="text-align:right">${fmt(c.currentStock)} tC</td>
        </tr>
        <tr style="border-bottom:1px solid #eee">
          <td style="padding:3px 0;color:#888">Posisi relatif</td>
          <td style="text-align:right">${(c.relativePosition * 100).toFixed(0)}%</td>
        </tr>
      </table>
    </div>
  `;

  L.popup({ maxWidth: 320 })
    .setLatLng(e.latlng)
    .setContent(content)
    .openOn(state.map2Instance);
}

// ── BOOTSTRAP ────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  setLang("id");
  applyLabels();
  renderLegend();
  toggleCalcBtn();
  selectMethod("ipcc");

  // Build KLHK year grid (2015–2024)
  const klhkGrid = $("klhk-year-grid");
  if (klhkGrid) {
    for (let y = 2015; y <= 2024; y++) {
      const btn = document.createElement("button");
      btn.className = "klhk-yr-btn";
      btn.dataset.year = String(y);
      btn.textContent = y;
      btn.onclick = () => setKlhkYear(y);
      klhkGrid.appendChild(btn);
    }
  }

  // Build Literature NDVI year grid (2015–2024)
  const ndviGrid = $("ndvi-year-grid");
  if (ndviGrid) {
    for (let y = 2015; y <= 2025; y++) {
      const btn = document.createElement("button");
      btn.className = "klhk-yr-btn ndvi-yr-btn";
      btn.dataset.year = String(y);
      btn.innerHTML = `${y}<span style="display:block;font-size:8px;opacity:0.65;margin-top:1px">L8</span>`;
      btn.onclick = () => setLitYear(y);
      ndviGrid.appendChild(btn);
    }
  }

  $("shp-input")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) processShpFile(file);
    e.target.value = "";
  });

  $("dem-input")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) processDemFile(file);
    e.target.value = "";
  });

  $("shp-input-lit")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) processLitShpFile(file);
    e.target.value = "";
  });

  // Show Google Sign-In only if GEE_CLIENT_ID is configured
  if (window.GEE_CLIENT_ID) {
    const gSec = $("gcc-google-section");
    if (gSec) gSec.style.display = "";
  }

  // Populate GEE year selector (last 8 years)
  const geeYearSel = $("gee-year");
  if (geeYearSel) {
    const curYear = new Date().getFullYear();
    for (let y = curYear - 1; y >= curYear - 8; y--) {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = y;
      if (y === curYear - 1) opt.selected = true;
      geeYearSel.appendChild(opt);
    }
  }

  const tryInit = () => {
    // Check if all required libraries are loaded
    if (window.L && window.L.Draw && window.GeoTIFF && window.Chart) {
      initMap();
    } else {
      setTimeout(tryInit, 250);
    }
  };
  setTimeout(tryInit, 500);
});
