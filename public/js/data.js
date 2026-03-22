// Sumber: KLHK NFI, SNI 7724:2011, IPCC 2006/2019
// ============================================================

// Mapping kode kelas tutupan lahan GeoTIFF → biomassa & fraksi karbon
// cf sumber: IPCC 2006 Table 4.3 / SNI 7724:2011
const LANDCOVER_CLASS_VALUES = {
  3: {
    name: "Forest",
    nameId: "Hutan",
    agb: 345.46,
    bgb: 100.89,
    cf: 0.47,
    color: "#2ca25f", // Vibrant Deep Green
  },
  5: {
    name: "Mangrove",
    nameId: "Mangrove",
    agb: 236.17,
    bgb: 73.45,
    cf: 0.47,
    color: "#02818a", // Deep Teal
  },
  13: {
    name: "Non-forest Vegetation",
    nameId: "Tumbuhan non Hutan",
    agb: 19.34,
    bgb: 4.56,
    cf: 0.47,
    color: "#addd8e", // Chartreuse / Light Green
  },
  21: {
    name: "Other Agriculture",
    nameId: "Pertanian Lainnya",
    agb: 64.64,
    bgb: 12.93,
    cf: 0.47,
    color: "#fee08b", // Sizzling Yellow
  },
  24: {
    name: "Settlement",
    nameId: "Permukiman",
    agb: 2.17,
    bgb: 0.63,
    cf: 0.47,
    color: "#e31a1c", // Vibrant Red
  },
  25: {
    name: "Other Non-vegetation",
    nameId: "Non Vegetasi Lainnya",
    agb: 2.4,
    bgb: 0.57,
    cf: 0.47,
    color: "#bdbdbd", // Light Grey
  },
  30: {
    name: "Mining",
    nameId: "Tambang",
    agb: 0.0,
    bgb: 0.0,
    cf: 0.47,
    color: "#8c510a", // Deep Brown
  },
  31: {
    name: "Shrimp Pond",
    nameId: "Tambak Udang",
    agb: 0.0,
    bgb: 0.0,
    cf: 0.47,
    color: "#4eb3d3", // Light Cyan
  },
  33: {
    name: "River",
    nameId: "Sungai",
    agb: 0.0,
    bgb: 0.0,
    cf: 0.47,
    color: "#2b8cbe", // Ocean Blue
  },
  35: {
    name: "Oil Palm",
    nameId: "Sawit",
    agb: 48.1,
    bgb: 15.63,
    cf: 0.47,
    color: "#ff7f00", // Bright Orange
  },
  40: {
    name: "Rice Paddy",
    nameId: "Sawah",
    agb: 10.0,
    bgb: 2.36,
    cf: 0.47,
    color: "#d9f0a3", // Pale Yellow-Green
  },
};

// Faktor konversi karbon ke CO₂
const CO2_FACTOR = 3.67;

// ── IPCC 2019 TROPICAL FOREST TYPES ──────────────────────────
// AGB & BGB dalam satuan t d.m./ha (tonnes dry matter per hectare)
// Sumber: IPCC 2019 Wetlands Supplement, Table 4.7
const IPCC_FOREST_TYPES = {
  tropical_rainforest: {
    name: "Tropical Rain Forest",
    nameId: "Hutan Hujan Tropis",
    agb: 350,
    bgb: +(350 * 0.37).toFixed(2), // = 129.5
    bgbRatio: 0.37,
    elevMax: 1000,
    color: "#31a354",
    descId: "Dataran rendah < 1.000m dpl",
    descEn: "Lowland < 1,000m a.s.l.",
  },
  tropical_mountain: {
    name: "Tropical Mountain Systems",
    nameId: "Ekosistem Pegunungan Tropis",
    agb: 205,
    bgb: +(205 * 0.27).toFixed(2), // = 55.35
    bgbRatio: 0.27,
    elevMin: 1000,
    color: "#006d2c",
    descId: "Dataran tinggi ≥ 1.000m dpl",
    descEn: "Highland ≥ 1,000m a.s.l.",
  },
};

const IPCC_ELEV_THRESHOLD = 1000; // meter di atas permukaan laut

// ── NDVI → CARBON (Literature / Lefebvre method) ─────────────
// Formula: y = -255.61x² + 494.84x - 154.45  (Karbon tC/ha vs NDVI)
// R² = 0.8574 · Source: Sentinel-2 regression
const NDVI_A = -255.61;
const NDVI_B = 494.84;
const NDVI_C = -154.45;

function ndviToCarbon(ndvi) {
  return Math.max(0, NDVI_A * ndvi * ndvi + NDVI_B * ndvi + NDVI_C);
}

// Three carbon classes derived from NDVI ranges
const NDVI_CARBON_CLASSES = {
  lit_high: {
    name: "High Carbon Stock",
    nameId: "Stok Karbon Tinggi",
    color: "#006837",
    ndviMin: 0.65,
  },
  lit_medium: {
    name: "Medium Carbon Stock",
    nameId: "Stok Karbon Sedang",
    color: "#78c679",
    ndviMin: 0.5,
  },
  lit_low: {
    name: "Low Carbon Stock",
    nameId: "Stok Karbon Rendah",
    color: "#ffffcc",
    ndviMin: 0.0,
  },
};

// ── HITUNG STOK KARBON PER KELAS KODE ───────────────────────
function calcStockByClassCode(code, areaHa, method) {
  const entry = LANDCOVER_CLASS_VALUES[code];
  if (!entry || !areaHa) return emptyStock();

  const cf = 0.47; // fraksi karbon seragam (IPCC 2006)
  let agb_ha = entry.agb; // AGB [Mg/ha] — nilai per hektar
  let bgb_ha = entry.bgb; // BGB [Mg/ha] — nilai per hektar

  // Lefebvre khusus mangrove
  if (method === "lefebvre" && code === 5) {
    agb_ha = 200.0;
    bgb_ha = 95.0;
  }

  let biomass_total, above, below, total;

  if (method === "nfi" || method === "klhk") {
    // ── Metodologi KLHK / NFI ─────────────────────────────────
    // Langkah 1 : biomass_total [Mg/ha] = AGB [Mg/ha] + BGB [Mg/ha]
    // Langkah 2 : areaHa sudah = Σ pixel × (res_X_m × res_Y_m) / 10.000
    //             (konversi pixel → ha sudah dilakukan saat sampling raster)
    // Langkah 3 : carbon [tC] = biomass_total [Mg/ha] × areaHa [ha] × 0.47
    biomass_total = agb_ha + bgb_ha; // biomassa [Mg/ha]
    above = agb_ha * areaHa * cf; // tC
    below = bgb_ha * areaHa * cf; // tC
    total = biomass_total * 0.47 * areaHa; // tC
  } else {
    // ── Metodologi IPCC / Lefebvre (default) ─────────────────
    biomass_total = (agb_ha + bgb_ha) * areaHa * 0.47; // total biomassa [Mg]
    above = agb_ha * 0.47 * areaHa; // tC
    below = bgb_ha * 0.47 * areaHa; // tC
    total = above + below; // tC
  }

  return {
    biomass_total, // Mg (IPCC) atau Mg/ha (KLHK)
    agb_ha, // AGB per hektar [Mg/ha]
    bgb_ha, // BGB per hektar [Mg/ha]
    aboveground: above, // karbon AGB (tC)
    belowground: below, // karbon BGB (tC)
    total: total, // total stok karbon (tC)
    co2Equivalent: total * CO2_FACTOR,
  };
}

// ── HITUNG STOK KARBON MANUAL ────────────────────────────────
function calcStock(key, areaHa) {
  const lt = CARBON_STOCK_FACTORS[key];
  if (!lt || !areaHa) return emptyStock();
  const total = (lt.agb + lt.bgb + lt.deadwood + lt.litter + lt.soil) * areaHa;
  return {
    aboveground: lt.agb * areaHa,
    belowground: lt.bgb * areaHa,
    deadwood: lt.deadwood * areaHa,
    litter: lt.litter * areaHa,
    soil: lt.soil * areaHa,
    total: total,
    co2Equivalent: total * CO2_FACTOR,
  };
}

function emptyStock() {
  return {
    biomass_total: 0,
    aboveground: 0,
    belowground: 0,
    total: 0,
    co2Equivalent: 0,
  };
}

// ── AREA POLYGON ─────────────────────────────────────────────
function calculatePolygonArea(coordinates) {
  if (!coordinates || !coordinates[0]) return 0;
  const ring = coordinates[0];
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    area += x1 * y2 - x2 * y1;
  }
  return (Math.abs(area) / 2) * 1232100;
}

// ── FORMAT ───────────────────────────────────────────────────
function fmt(n) {
  if (!n || isNaN(n)) return "0";
  return Math.round(n).toLocaleString("id-ID");
}
function fmtDec(n, d = 2) {
  if (!n || isNaN(n)) return "0";
  return (+n).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// ── CONSERVATION & RESTORATION CLASSIFICATION ─────────────────
// Based on linear regression of carbon stock trends 2015-2024

/**
 * Classification categories for conservation/restoration
 * Based on slope (β₁), R², and relative stock position
 */
const CLASSIFICATION_CATEGORIES = {
  KONSERVASI_KETAT: {
    id: "konservasi_ketat",
    name: "Konservasi Ketat",
    nameEn: "Strict Conservation",
    description: "> 100 tC/ha (Tren Positif)",
    color: "#0d9488", // Teal
    priority: 1,
  },
  PEMANTAUAN_INTENSIF: {
    id: "pemantauan_intensif",
    name: "Konservasi & Pemantauan",
    nameEn: "Conservation & Monitoring",
    description: "> 100 tC/ha (Negatif) / 40-100 tC/ha (Positif)",
    color: "#52b788", // Green
    priority: 2,
  },
  RESTORASI_PASIF: {
    id: "restorasi_pasif",
    name: "Restorasi Pasif / Pencegahan",
    nameEn: "Passive Restoration",
    description: "40-100 tC/ha (Negatif) / < 40 tC/ha (Positif)",
    color: "#f2cc8f", // Yellow
    priority: 3,
  },
  RESTORASI_AKTIF: {
    id: "restorasi_aktif",
    name: "Restorasi Aktif Prioritas",
    nameEn: "Active Restoration Priority",
    description: "< 40 tC/ha (Tren Negatif)",
    color: "#e07a5f", // Coral/Orange
    priority: 4,
  },
};

/**
 * Calculate linear regression (slope β₁ and R²)
 * @param {number[]} years - Array of years (e.g., [2015, 2016, ...])
 * @param {number[]} values - Array of carbon values corresponding to years
 * @returns {Object} { slope, intercept, r2, n }
 */
function linearRegression(years, values) {
  const n = years.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0, n: n };

  // Calculate means
  const sumX = years.reduce((a, b) => a + b, 0);
  const sumY = values.reduce((a, b) => a + b, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;

  // Calculate slope (β₁) and intercept (β₀)
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (years[i] - meanX) * (values[i] - meanY);
    denominator += (years[i] - meanX) ** 2;
  }

  const slope = denominator !== 0 ? numerator / denominator : 0;
  const intercept = meanY - slope * meanX;

  // Calculate R² (coefficient of determination)
  let ssRes = 0; // Residual sum of squares
  let ssTot = 0; // Total sum of squares
  for (let i = 0; i < n; i++) {
    const predicted = slope * years[i] + intercept;
    ssRes += (values[i] - predicted) ** 2;
    ssTot += (values[i] - meanY) ** 2;
  }

  const r2 = ssTot !== 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, r2: Math.max(0, r2), n };
}

/**
 * Classify forest based on carbon stock trend
 * @param {number} slope - Regression slope (β₁) in tC/year
 * @param {number} r2 - R² value (0-1)
 * @param {number} currentStock - Current carbon stock (2024)
 * @param {number} avgStock - Average carbon stock across all forests
 * @returns {Object} Classification result
 */
function classifyForest(slope, r2, currentStock, areaHa) {
  // Hitung Carbon Density aktual (tC/ha)
  const carbonDensity = areaHa > 0 ? currentStock / areaHa : 0;
  
  // Tren signifikan dari Regresi Linear (Slope b > 0 positif, b < 0 negatif)
  const isPositive = slope > 0;
  
  let category;

  // Axis 1: Carbon Density Thresholds
  if (carbonDensity > 100) { // Zona Konservasi
    if (isPositive) category = CLASSIFICATION_CATEGORIES.KONSERVASI_KETAT;
    else category = CLASSIFICATION_CATEGORIES.PEMANTAUAN_INTENSIF;
  } else if (carbonDensity >= 40 && carbonDensity <= 100) { // Zona Konservasi Intensif
    if (isPositive) category = CLASSIFICATION_CATEGORIES.PEMANTAUAN_INTENSIF;
    else category = CLASSIFICATION_CATEGORIES.RESTORASI_PASIF;
  } else { // Zona Restorasi (< 40)
    if (isPositive) category = CLASSIFICATION_CATEGORIES.RESTORASI_PASIF;
    else category = CLASSIFICATION_CATEGORIES.RESTORASI_AKTIF;
  }

  return {
    category,
    slope: slope, // Laju perubahan total (tC/thn)
    slopeDensity: areaHa > 0 ? slope / areaHa : 0, // Laju perubahan per Hektar (tC/ha/thn)
    r2,
    currentStock,
    areaHa,
    carbonDensity,
    trend: slope > 0 ? "positif" : slope < 0 ? "negatif" : "stagnan",
    consistency: r2 >= 0.5 ? "konsisten" : r2 >= 0.2 ? "sedang" : "tidak teratur",
  };
}

/**
 * Calculate classification for all forests based on multi-year data
 * @param {Object} carbonByYear - { year: { byNama: { nama: { totalCarbon, totalArea } } } }
 * @returns {Array} Array of classification results per forest
 */
function calculateAllClassifications(carbonByYear) {
  const years = Object.keys(carbonByYear).sort().map(Number);
  if (years.length < 2) return [];

  // Collect all forest names
  const forestNames = new Set();
  years.forEach((y) => {
    if (carbonByYear[y]?.byNama) {
      Object.keys(carbonByYear[y].byNama).forEach((key) => {
        forestNames.add(key);
      });
    }
  });

  // Calculate average stock across all forests for relative position
  const latestYear = Math.max(...years);
  let totalStockAll = 0;
  let forestCount = 0;

  forestNames.forEach((key) => {
    const data = carbonByYear[latestYear]?.byNama?.[key];
    if (data?.totalCarbon > 0) {
      totalStockAll += data.totalCarbon;
      forestCount++;
    }
  });
  const avgStock = forestCount > 0 ? totalStockAll / forestCount : 0;

  // Calculate classification for each forest
  const results = [];
  forestNames.forEach((key) => {
    const carbonValues = years.map(
      (y) => carbonByYear[y]?.byNama?.[key]?.totalCarbon || 0,
    );

    // Skip forests with no data
    if (carbonValues.every((v) => v === 0)) return;

    const { slope, r2 } = linearRegression(years, carbonValues);
    const currentStock = carbonValues[carbonValues.length - 1] || 0;

    // Get the forest name, kelas, and area from the latest data
    const forestData = carbonByYear[latestYear]?.byNama?.[key];
    const areaHa = forestData?.totalArea || 0;

    const classification = classifyForest(slope, r2, currentStock, areaHa);

    results.push({
      key,
      nama: forestData?.namobj || key.split("||")[0],
      kelas: forestData?.kelas || key.split("||")[1] || "–",
      totalArea: areaHa,
      ...classification,
    });
  });

  // Sort by priority
  results.sort((a, b) => {
    const priorityDiff = a.category.priority - b.category.priority;
    if (priorityDiff !== 0) return priorityDiff;
    return b.score - a.score;
  });

  return results;
}
