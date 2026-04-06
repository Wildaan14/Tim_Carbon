import sys

with open('public/js/app.js', 'r', encoding='utf-8') as f:
    v = f.read()

v = v.replace('NDVI_Landsat8/karbon_lit_${year}.json', 'NDVI_Landsat8/karbon_ndvi_${year}.json')

old_tiff = """      // Tetap muat TIFF di background untuk peta (Overlay)
      const tiffUrl = `NDVI_Landsat8/NDVI_${year}.tif`;
      loadNdviFromLocalAsset(tiffUrl, `NDVI_${year}.tif`).then(async (raster) => {
        state.ndviRaster = raster;
        if (state.mapInstance && raster) {
          state.carbonLayer = await addNdviOverlayToMap(raster, state.mapInstance, state.nfiShpPolygon);
          if (state.activeMapLayer === "carbon") state.carbonLayer.addTo(state.mapInstance);
        }
      });"""

new_geo = """      // Tetap muat GeoJSON Cache
      const geoUrl = `NDVI_Landsat8/ndvi_${year}.geojson`;
      fetch(geoUrl).then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        if (state.mapInstance) {
          if (state.ndviGeoLayer) state.mapInstance.removeLayer(state.ndviGeoLayer);
          state.ndviGeoLayer = L.geoJSON(data, {
            style: function (feature) {
              const cid = feature.properties.class_id;
              let color = 'transparent';
              if (cid === 2) color = '#c8e6c9';
              else if (cid === 3) color = '#4caf50';
              else if (cid === 4) color = '#0d4a27';
              return { fillColor: color, fillOpacity: 0.85, color: color, weight: 0 };
            }
          });
          state.carbonLayer = state.ndviGeoLayer;
          if (state.activeMapLayer === "carbon" || state.activeMapLayer === "cover") {
             state.carbonLayer.addTo(state.mapInstance);
          }
        }
      }).catch(e => console.warn(e));"""

v = v.replace(old_tiff, new_geo)

old_fallback = """  // ── 3. Fallback: Muat TIFF & Hitung (Slow) ──────────────────────
  try {
    const tiffUrl = `NDVI_Landsat8/NDVI_${year}.tif`;
    state.ndviRaster = await loadNdviFromLocalAsset(tiffUrl, `NDVI_${year}.tif`);
    state.litPrecomputed = null; 

    if (state.ndviRaster) {
      showNdviStatus("ok", `NDVI ${year} ✓ · Landsat 8 30m`);
      if (state.mapInstance) {
        state.carbonLayer = await addNdviOverlayToMap(state.ndviRaster, state.mapInstance, state.nfiShpPolygon);
        setMapLayer("carbon");
      }
      if (activeBtn) activeBtn.classList.remove("loading");
      toggleCalcBtn();
      if (state.nfiShpFeatures?.length) await calculate();
    } else {
      showNdviStatus("error", `⚠ Data tahun ${year} tidak tersedia.`);
    }"""

new_fallback = """  // ── 3. Fallback: Muat GeoJSON ──────────────────────
  try {
    const geoUrl = `NDVI_Landsat8/ndvi_${year}.geojson`;
    const res = await fetch(geoUrl);
    const data = await res.json();
    state.litPrecomputed = null; 

    if (data) {
      showNdviStatus("ok", `NDVI ${year} ✓ · Landsat 8 30m`);
      if (state.mapInstance) {
          if (state.ndviGeoLayer) state.mapInstance.removeLayer(state.ndviGeoLayer);
          state.ndviGeoLayer = L.geoJSON(data, {
            style: function (feature) {
              const cid = feature.properties.class_id;
              let color = 'transparent';
              if (cid === 2) color = '#c8e6c9';
              else if (cid === 3) color = '#4caf50';
              else if (cid === 4) color = '#0d4a27';
              return { fillColor: color, fillOpacity: 0.85, color: color, weight: 0 };
            }
          });
          state.carbonLayer = state.ndviGeoLayer;
          setMapLayer("carbon");
      }
      if (activeBtn) activeBtn.classList.remove("loading");
      toggleCalcBtn();
    } else {
      showNdviStatus("error", `⚠ Data tahun ${year} tidak tersedia.`);
    }"""

v = v.replace(old_fallback, new_fallback)

old_calc_lit = """      } else if (isLit) {
        // ── Literature: NDVI Landsat 8 (Real-time calculation dari TIF) ────
        if (!state.ndviRaster) {
          showError("⚠ Muat data NDVI terlebih dahulu.");
          restoreBtn();
          hideLoader();
          return;
        }"""

new_calc_lit = """      } else if (isLit) {
        // ── Literature: NDVI Landsat 8 (Real-time calculation dari TIF) ────
        if (!state.ndviGeoLayer && !state.litPrecomputed) {
          showError("⚠ Muat data NDVI terlebih dahulu.");
          restoreBtn();
          hideLoader();
          return;
        }"""
v = v.replace(old_calc_lit, new_calc_lit)

# Disable the slow fallback calculation logic since we already have it in the JSON file
old_realtime = """        // Hitung real-time dari raster NDVI
        const ndviRes = await processNdviRaster(
          state.ndviRaster,
          clipRings,
          state.nfiShpFeatures
        );"""

new_realtime = """        // Real-time raster disabled for Cached GeoJSON approach.
        // Caches exist and handle everything.
        const ndviRes = { areaHa: 0, totalCarbon: 0, classCounts: {}, classCarbons: {} };"""
v = v.replace(old_realtime, new_realtime)

# And fix choropleth usage because we disabled per-name
old_choro_lit = "renderLitChoropleth(state._litByNama || []);"
new_choro_lit = "/* renderLitChoropleth(state._litByNama || []); disabled for global cache */"
v = v.replace(old_choro_lit, new_choro_lit)

with open('public/js/app.js', 'w', encoding='utf-8') as f:
    f.write(v)

print("Replaced app.js logic")
