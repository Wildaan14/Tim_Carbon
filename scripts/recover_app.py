import sys

with open('public/js/app.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_block = """
// ============================================================
// METHOD & LAYER CONTROL
// ============================================================

function selectMethod(m) {
  state.method = m;
  document.body.dataset.method = m;
  document.querySelectorAll(".method-chip").forEach((el, i) => {
    const methods = ["ipcc", "nfi", "lefebvre"];
    el.classList.toggle("active", methods[i] === m);
  });
  const labels = { ipcc: "IPCC 2019", nfi: "KLHK", lefebvre: "Metode NDVI" };
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
      // Auto-load 2024 NDVI
      setTimeout(() => {
        if (!state.litPrecomputed) setLitYear(2024);
      }, 300);
    }
  }
  toggleCalcBtn();
}

function handleYearChange(y) {
  state.year = y;
}

function setMapLayer(type) {
  state.activeMapLayer = type;
  $("ltg-cover")?.classList.toggle("active", type === "cover");
  $("ltg-carbon")?.classList.toggle("active", type === "carbon");
  $("ltg-namaHutan")?.classList.toggle("active", type === "namaHutan");
  
  const isLitActive = state.method === "lefebvre";
  
  // Raster/Tile Layers (IPCC, KLHK)
  const coverOp = type === "cover" ? 0.78 : 0;
  const carbonOp = type === "carbon" ? 0.82 : 0;
  if (state.coverLayer && typeof state.coverLayer.setOpacity === 'function') state.coverLayer.setOpacity(coverOp);
  if (state.carbonLayer && typeof state.carbonLayer.setOpacity === 'function') {
     if (!state.ndviGeoLayer || state.carbonLayer !== state.ndviGeoLayer) {
        state.carbonLayer.setOpacity(carbonOp);
     }
  }

  // Handle NDVI GeoJSON Layer styling specifically
  if (isLitActive && state.ndviGeoLayer) {
    state.ndviGeoLayer.setStyle(function(feature) {
      if (type === 'namaHutan') return { opacity: 0, fillOpacity: 0, interactive: false };
      const cid = feature.properties.class_id;
      const isCarbonMode = type === 'carbon';
      let color = 'transparent';
      if (cid === 2) color = isCarbonMode ? '#80cdc1' : '#c8e6c9';
      else if (cid === 3) color = isCarbonMode ? '#018571' : '#4caf50';
      else if (cid === 4) color = isCarbonMode ? '#00441b' : '#0d4a27';
      const op = (type === 'cover' || type === 'carbon') ? 0.85 : 0;
      return { fillColor: color, fillOpacity: op, color: color, weight: 0, interactive: op > 0 };
    });
    
    if (type === 'cover' || type === 'carbon') {
      if (!state.mapInstance.hasLayer(state.ndviGeoLayer)) state.ndviGeoLayer.addTo(state.mapInstance);
    }
  }

  // SHP layer
  if (state.nfiShpLayer) {
    state.nfiShpLayer.eachLayer((l) => {
      const showShp = type === "namaHutan" || (type === "carbon" && isLitActive);
      if (showShp && (l._namaColor || l._litColor)) {
        const isLitMode = isLitActive && l._litColor;
        const fillColor = isLitMode ? l._litColor : l._namaColor;
        l.setStyle(isLitMode ? {
          fillColor, fillOpacity: 0.75, color: "#1a3a1a", weight: 0.8, opacity: 0.5
        } : {
          fillColor, fillOpacity: 0.55, color: fillColor, weight: 1.5, opacity: 1
        });
        if (!l.getTooltip() && l._shpNama) {
          l.bindTooltip(`<strong>${l._shpNama}</strong>`, { sticky: true, className: "shp-tooltip" });
        }
      } else {
        l.setStyle({ fillOpacity: 0, opacity: 0, weight: 0, interactive: false });
        if (l.getTooltip()) l.unbindTooltip();
      }
    });
  }

  const showBottomBar = type === "namaHutan" || (type === "carbon" && isLitActive);
  if (showBottomBar && state.forestCarbonData?.length) {
    renderBottomBar(state.forestCarbonData);
    renderForestStatsTable(state.forestCarbonData);
  } else {
    $("bottom-bar")?.classList.remove("visible");
  }

  // Raster click handler
  if (state.mapInstance) {
    state.mapInstance.off("click", _onMapClickRasterInfo);
    if (type === "cover" || type === "carbon") {
      state.mapInstance.on("click", _onMapClickRasterInfo);
    }
  }

  updateMapLegend(type);
}
"""

# Re-assemble
# Correct switchTab ends at 303 (based on my previous view_file)
# updateMapLegend starts at or before line 500 now due to corruption.
# I'll search for the clean 'function updateMapLegend'.

start_of_corruption = 303
end_of_corruption = -1
for i in range(300, len(lines)):
    if 'function updateMapLegend(type) {' in lines[i]:
        end_of_corruption = i
        break

if end_of_corruption != -1:
    content = "".join(lines[:start_of_corruption]) + new_block + "".join(lines[end_of_corruption:])
    with open('public/js/app.js', 'w', encoding='utf-8') as f:
        f.write(content)
else:
    print("Error: Could not find updateMapLegend")
    sys.exit(1)
