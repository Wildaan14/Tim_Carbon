// ============================================================
// raster.js — GeoTIFF upload, sampling, & map overlay
// ============================================================

// ── CRS DETECTION & UTM ↔ WGS84 CONVERSION ──────────────────

/** Detect CRS from GeoTIFF geoKeys. Returns { type, zone, hemisphere, epsg } */
function detectGeoTiffCrs(image) {
  try {
    const gk = image.getGeoKeys?.() || {};
    const modelType = gk.GTModelTypeGeoKey; // 1=Projected, 2=Geographic
    const projEpsg = gk.ProjectedCSTypeGeoKey; // e.g. 32748

    if (modelType === 1 && projEpsg && projEpsg !== 32767) {
      // UTM North: EPSG 32601-32660
      if (projEpsg >= 32601 && projEpsg <= 32660) {
        return {
          type: "utm",
          zone: projEpsg - 32600,
          hemisphere: "N",
          epsg: projEpsg,
        };
      }
      // UTM South: EPSG 32701-32760
      if (projEpsg >= 32701 && projEpsg <= 32760) {
        return {
          type: "utm",
          zone: projEpsg - 32700,
          hemisphere: "S",
          epsg: projEpsg,
        };
      }
      return { type: "projected", epsg: projEpsg };
    }

    // Fallback: parse citation string (e.g. "WGS 84 / UTM zone 48S")
    // Needed when ProjectedCSTypeGeoKey=32767 (user-defined) — rasterio tanpa EPSG registry
    if (modelType === 1 || projEpsg === 32767) {
      const citation =
        gk.PCSCitationGeoKey ||
        gk.GTCitationGeoKey ||
        image.fileDirectory?.GeoAsciiParams ||
        "";
      const m = citation.match(/UTM\s+zone\s+(\d+)([NS])/i);
      if (m) {
        const zone = parseInt(m[1], 10);
        const hemi = m[2].toUpperCase();
        const epsg = hemi === "N" ? 32600 + zone : 32700 + zone;
        return { type: "utm", zone, hemisphere: hemi, epsg };
      }
    }
  } catch (_) {
    /* ignore */
  }
  return { type: "wgs84" };
}

/** UTM easting/northing → WGS84 lat/lon */
function utmToWgs84(easting, northing, zone, hemisphere) {
  const a = 6378137.0,
    f = 1 / 298.257223563;
  const e2 = 2 * f - f * f,
    ep2 = e2 / (1 - e2),
    k0 = 0.9996;

  const x = easting - 500000;
  const y = hemisphere === "S" ? northing - 10000000 : northing;

  const lon0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const T1 = Math.tan(phi1) ** 2;
  const C1 = ep2 * Math.cos(phi1) ** 2;
  const R1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const D = x / (N1 * k0);

  const lat =
    phi1 -
    ((N1 * Math.tan(phi1)) / R1) *
      (D ** 2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) *
          D ** 6) /
          720);
  const lon =
    lon0 +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5) /
        120) /
      Math.cos(phi1);

  return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
}

/** WGS84 lat/lon → UTM easting/northing for a given zone */
function wgs84ToUtmPoint(lat, lon, zone) {
  const a = 6378137.0,
    f = 1 / 298.257223563;
  const e2 = 2 * f - f * f,
    ep2 = e2 / (1 - e2),
    k0 = 0.9996;
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
  const Nr =
    k0 *
    (M +
      N *
        Math.tan(latR) *
        (A ** 2 / 2 +
          ((5 - T + 9 * C + 4 * C ** 2) * A ** 4) / 24 +
          ((61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6) / 720));
  return { easting: E, northing: lat < 0 ? Nr + 10000000 : Nr };
}

/** Get WGS84 bbox [minLon, minLat, maxLon, maxLat] regardless of raster CRS */
function getBboxWgs84(raster) {
  const [minX, minY, maxX, maxY] = raster.bbox;
  if (raster.crs?.type === "utm") {
    const { zone, hemisphere } = raster.crs;
    const sw = utmToWgs84(minX, minY, zone, hemisphere);
    const ne = utmToWgs84(maxX, maxY, zone, hemisphere);
    return [sw.lon, sw.lat, ne.lon, ne.lat];
  }
  return [minX, minY, maxX, maxY];
}

// Load GeoTIFF → { fileName, width, height, bbox, data, nodata, crs }
async function loadGeoTiff(file) {
  if (!window.GeoTIFF) {
    throw new Error("GeoTIFF library not loaded. Please refresh the page.");
  }

  const arrayBuffer = await file.arrayBuffer();
  const tiff = await window.GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();
  const rasters = await image.readRasters({ interleave: true });
  const bbox = image.getBoundingBox(); // [minX, minY, maxX, maxY]
  const width = image.getWidth();
  const height = image.getHeight();
  const nodata = image.fileDirectory?.GDAL_NODATA
    ? parseFloat(image.fileDirectory.GDAL_NODATA)
    : 255;
  const crs = detectGeoTiffCrs(image);

  return {
    fileName: file.name,
    width,
    height,
    bbox,
    data: rasters,
    nodata,
    crs,
  };
}

// Load GeoTIFF directly from URL (COG-optimised, avoids ArrayBuffer wrapping)
async function loadGeoTiffFromUrl(url, fileName) {
  if (!window.GeoTIFF) {
    throw new Error("GeoTIFF library not loaded. Please refresh the page.");
  }
  const tiff = await window.GeoTIFF.fromUrl(url);
  const image = await tiff.getImage();
  const rasters = await image.readRasters({ interleave: true });
  const bbox = image.getBoundingBox();
  const width = image.getWidth();
  const height = image.getHeight();
  const nodata = image.fileDirectory?.GDAL_NODATA
    ? parseFloat(image.fileDirectory.GDAL_NODATA)
    : 255;
  const crs = detectGeoTiffCrs(image);
  return {
    fileName: fileName || url.split("/").pop(),
    width,
    height,
    bbox,
    data: rasters,
    nodata,
    crs,
  };
}

// Load GeoTIFF from raw ArrayBuffer (for pre-fetched buffers)
async function loadGeoTiffFromBuffer(buffer, fileName) {
  if (!window.GeoTIFF) {
    throw new Error("GeoTIFF library not loaded. Please refresh the page.");
  }
  const tiff = await window.GeoTIFF.fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const rasters = await image.readRasters({ interleave: true });
  const bbox = image.getBoundingBox();
  const width = image.getWidth();
  const height = image.getHeight();
  const nodata = image.fileDirectory?.GDAL_NODATA
    ? parseFloat(image.fileDirectory.GDAL_NODATA)
    : 255;
  const crs = detectGeoTiffCrs(image);
  return {
    fileName: fileName || "raster.tif",
    width,
    height,
    bbox,
    data: rasters,
    nodata,
    crs,
  };
}

// ── POINT IN POLYGON (ray casting) ──────────────────────────
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0],
      yi = poly[i][1];
    const xj = poly[j][0],
      yj = poly[j][1];
    const ok = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (ok) inside = !inside;
  }
  return inside;
}

// ── PIXEL → CLASS HELPERS ────────────────────────────────────

// Ukuran pixel seragam KLHK + IPCC = 894 m² = 0.0894 ha
const MAPBIOMASS_PIXEL_AREA_HA = 894 / 10000;

// Average pixel area in hectares, using the raster's spatial reference.
function computeAvgPixelAreaHa(raster) {
  const [minX, minY, maxX, maxY] = raster.bbox;
  const resX = (maxX - minX) / raster.width;
  const resY = (maxY - minY) / raster.height;
  if (raster.crs?.type === "utm") {
    return MAPBIOMASS_PIXEL_AREA_HA;
  }
  const cLat = (minY + maxY) / 2;
  const mpLon = 111412.84 * Math.cos((cLat * Math.PI) / 180);
  const mpLat = 111132.954 - 559.822 * Math.cos((2 * cLat * Math.PI) / 180);
  return Math.abs(resX * mpLon * resY * mpLat) / 10000;
}

// Maps a raw pixel value to a LANDCOVER_CLASS_VALUES key.
// Supports two raster formats:
//   • Integer class codes  (e.g. 3, 5, 13 …) — direct lookup
//   • Float AGB+BGB values (e.g. 40.1715 Mg/pixel for Forest at 30 m resolution)
//     — converts to Mg/ha and matches the nearest class by total biomass
function findClassCodeByPixelValue(pixelValue, pixelAreaHa) {
  // 1. Integer class code: diff from nearest integer < 0.01
  const rounded = Math.round(pixelValue);
  if (
    Math.abs(pixelValue - rounded) < 0.01 &&
    LANDCOVER_CLASS_VALUES[rounded]
  ) {
    return rounded;
  }
  // 2. Float biomass value (Mg/pixel) → convert to Mg/ha → nearest class
  if (!pixelAreaHa || pixelAreaHa <= 0) return null;
  const biomassPerHa = pixelValue / pixelAreaHa;
  let bestCode = null,
    bestDiff = Infinity;
  for (const [code, cl] of Object.entries(LANDCOVER_CLASS_VALUES)) {
    const expected = cl.agb + cl.bgb;
    const diff = Math.abs(biomassPerHa - expected);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestCode = parseInt(code);
    }
  }
  if (bestCode === null) return null;
  const clExp =
    LANDCOVER_CLASS_VALUES[bestCode].agb + LANDCOVER_CLASS_VALUES[bestCode].bgb;
  // Accept match within 15 % tolerance (or ≤ 1 Mg/ha for near-zero classes)
  if (clExp > 0 && bestDiff / clExp > 0.15) return null;
  if (clExp === 0 && bestDiff > 1) return null;
  return bestCode;
}

// ── FULL RASTER SAMPLING ─────────────────────────────────────
// Scan semua pixel dan hitung luas per kelas (tanpa polygon mask)
// Returns { classCode: areaHa }
function sampleFullRaster(raster) {
  const [minX, minY, maxX, maxY] = raster.bbox;
  const { width, height, data, nodata } = raster;
  const resX = (maxX - minX) / width;
  const resY = (maxY - minY) / height;
  const isUtm = raster.crs?.type === "utm";
  // UTM: gunakan ukuran pixel seragam 894 m²
  const utmPixelHa = isUtm ? MAPBIOMASS_PIXEL_AREA_HA : 0;
  const counts = {};

  for (let j = 0; j < height; j++) {
    let pxHa;
    if (isUtm) {
      pxHa = utmPixelHa;
    } else {
      const lat = maxY - (j + 0.5) * resY;
      const mpLat = 111132.954 - 559.822 * Math.cos((2 * lat * Math.PI) / 180);
      const mpLon = 111412.84 * Math.cos((lat * Math.PI) / 180);
      pxHa = Math.abs(resX * mpLon * resY * mpLat) / 10000.0;
    }

    for (let i = 0; i < width; i++) {
      const val = data[j * width + i];
      if (
        val === undefined ||
        val === null ||
        Number.isNaN(val) ||
        val === nodata ||
        val === 0
      )
        continue;
      counts[val] = (counts[val] || 0) + pxHa;
    }
  }
  return counts;
}

// ── POLYGON MASKED SAMPLING ──────────────────────────────────
// Returns { classCode: areaHa } hanya dalam polygon
function sampleRasterByPolygon(raster, polygon) {
  const [minX, minY, maxX, maxY] = raster.bbox;
  const { width, height, data, nodata } = raster;
  const resX = (maxX - minX) / width;
  const resY = (maxY - minY) / height;
  const isUtm = raster.crs?.type === "utm";
  const utmPixelHa = isUtm ? MAPBIOMASS_PIXEL_AREA_HA : 0;
  const counts = {};

  // Polygon comes as [[lng,lat],...] in WGS84.
  // For UTM rasters, convert ring to UTM once (cheaper than converting every pixel).
  let ring = Array.isArray(polygon[0][0]) ? polygon[0] : polygon;
  if (isUtm) {
    const { zone } = raster.crs;
    ring = ring.map(([lng, lat]) => {
      const u = wgs84ToUtmPoint(lat, lng, zone);
      return [u.easting, u.northing];
    });
  }

  for (let j = 0; j < height; j++) {
    const y = maxY - (j + 0.5) * resY; // northing (UTM) or lat (WGS84)
    let rowPxHa;
    if (isUtm) {
      rowPxHa = utmPixelHa;
    } else {
      const mpLat = 111132.954 - 559.822 * Math.cos((2 * y * Math.PI) / 180);
      const mpLon = 111412.84 * Math.cos((y * Math.PI) / 180);
      rowPxHa = Math.abs(resX * mpLon * resY * mpLat) / 10000.0;
    }

    for (let i = 0; i < width; i++) {
      const x = minX + (i + 0.5) * resX; // easting (UTM) or lon (WGS84)
      if (!pointInPolygon(x, y, ring)) continue;
      const val = data[j * width + i];
      if (
        val === undefined ||
        val === null ||
        Number.isNaN(val) ||
        val === nodata ||
        val === 0
      )
        continue;
      counts[val] = (counts[val] || 0) + rowPxHa;
    }
  }
  return counts;
}

// ── MULTI-RING POLYGON SAMPLING (efisien: satu pass untuk banyak ring) ──────
// Sama seperti sampleRasterByPolygon tetapi menerima ARRAY ring sekaligus.
// Setiap pixel hanya di-cek pointInPolygon untuk ring yang bounding-box-nya mencakup pixel tersebut.
// Jauh lebih cepat dari memanggil sampleRasterByPolygon N kali berturut-turut.
// rings = [[lng,lat],...] rings (WGS84)
// Returns { classCode: areaHa }
async function sampleRasterByRings(raster, rings) {
  if (!rings || !rings.length) return sampleFullRaster(raster);

  const [minX, minY, maxX, maxY] = raster.bbox;
  const { width, height, data, nodata } = raster;
  const resX = (maxX - minX) / width;
  const resY = (maxY - minY) / height;
  const isUtm = raster.crs?.type === "utm";
  const utmPixelHa = isUtm ? MAPBIOMASS_PIXEL_AREA_HA : 0;
  const counts = {};

  // Normalisasi tiap ring & konversi ke CRS raster
  const normRings = rings.map((ring) => {
    let r = Array.isArray(ring[0][0]) ? ring[0] : ring;
    if (isUtm) {
      const { zone } = raster.crs;
      r = r.map(([lng, lat]) => {
        const u = wgs84ToUtmPoint(lat, lng, zone);
        return [u.easting, u.northing];
      });
    }
    return r;
  });

  // Pre-compute bounding-box tiap ring (dalam koordinat raster) untuk fast-reject
  const ringBboxes = normRings.map((r) => {
    const xs = r.map((p) => p[0]);
    const ys = r.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  });

  const CHUNK = 200;
  for (let j = 0; j < height; j++) {
    if (j % CHUNK === 0 && j > 0) await new Promise((r) => setTimeout(r, 0));
    const y = maxY - (j + 0.5) * resY;
    let rowPxHa;
    if (isUtm) {
      rowPxHa = utmPixelHa;
    } else {
      const mpLat = 111132.954 - 559.822 * Math.cos((2 * y * Math.PI) / 180);
      const mpLon = 111412.84 * Math.cos((y * Math.PI) / 180);
      rowPxHa = Math.abs(resX * mpLon * resY * mpLat) / 10000.0;
    }

    for (let i = 0; i < width; i++) {
      const x = minX + (i + 0.5) * resX;

      // Fast-reject: cek apakah pixel masuk bounding-box salah satu ring
      let inAnyBbox = false;
      for (let ri = 0; ri < ringBboxes.length; ri++) {
        const [bx0, by0, bx1, by1] = ringBboxes[ri];
        if (x >= bx0 && x <= bx1 && y >= by0 && y <= by1) {
          inAnyBbox = true;
          break;
        }
      }
      if (!inAnyBbox) continue;

      // Precise: cek pointInPolygon hanya untuk ring yang bboxnya cocok
      let inside = false;
      for (let ri = 0; ri < normRings.length; ri++) {
        const [bx0, by0, bx1, by1] = ringBboxes[ri];
        if (x < bx0 || x > bx1 || y < by0 || y > by1) continue;
        if (pointInPolygon(x, y, normRings[ri])) {
          inside = true;
          break;
        }
      }
      if (!inside) continue;

      const val = data[j * width + i];
      if (
        val === undefined ||
        val === null ||
        Number.isNaN(val) ||
        val === nodata ||
        val === 0
      )
        continue;
      counts[val] = (counts[val] || 0) + rowPxHa;
    }
  }
  return counts;
}

// ── PER-FEATURE SAMPLING (satu pass, hasil total + per-namobj) ───────────────
// features = GeoJSON feature array (dengan properties namobj/kelas)
// Returns { total: {classCode: areaHa}, byNama: { namobj: { kelas, classCounts } } }
async function sampleRasterByFeatures(raster, features) {
  if (!features?.length)
    return { total: await sampleRasterByRings(raster, []), byNama: {} };

  const [minX, minY, maxX, maxY] = raster.bbox;
  const { width, height, data, nodata } = raster;
  const resX = (maxX - minX) / width;
  const resY = (maxY - minY) / height;
  const isUtm = raster.crs?.type === "utm";
  const utmPixelHa = isUtm ? MAPBIOMASS_PIXEL_AREA_HA : 0;

  // Build { namobj, kelas, ring } per feature part
  const entries = [];
  features.forEach((feat) => {
    const p = feat.properties || {};
    const namobj = p.namobj || p.NAMOBJ || p.NamObj || "Area Hutan";
    const kelas = p.kelas || p.KELAS || p.Kelas || "–";
    const geom = feat.geometry;
    if (!geom?.coordinates) return;
    const rawRings =
      geom.type === "Polygon"
        ? [geom.coordinates[0]]
        : geom.type === "MultiPolygon"
          ? geom.coordinates.map((poly) => poly[0])
          : [];
    rawRings.forEach((rawRing) => {
      let ring = rawRing;
      if (isUtm) {
        const { zone } = raster.crs;
        ring = rawRing.map(([lng, lat]) => {
          const u = wgs84ToUtmPoint(lat, lng, zone);
          return [u.easting, u.northing];
        });
      }
      // Compound key namobj||kelas agar Hutan Lindung/Produksi/Konservasi tidak dicampur
      const key = `${namobj}||${kelas}`;
      entries.push({ key, namobj, kelas, ring });
    });
  });

  // Pre-compute bboxes untuk fast-reject per ring
  const bboxes = entries.map(({ ring }) => {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  });
  // Global bbox untuk ultra-fast-reject tiap baris/kolom
  const gMinX = Math.min(...bboxes.map((b) => b[0]));
  const gMinY = Math.min(...bboxes.map((b) => b[1]));
  const gMaxX = Math.max(...bboxes.map((b) => b[2]));
  const gMaxY = Math.max(...bboxes.map((b) => b[3]));

  const total = {};
  const byNama = {};
  entries.forEach(({ key, namobj, kelas }) => {
    if (!byNama[key]) byNama[key] = { namobj, kelas, classCounts: {} };
  });

  const CHUNK = 200;
  for (let j = 0; j < height; j++) {
    if (j % CHUNK === 0 && j > 0) await new Promise((r) => setTimeout(r, 0));
    const y = maxY - (j + 0.5) * resY;
    if (y < gMinY || y > gMaxY) continue; // baris di luar semua bbox

    let rowPxHa;
    if (isUtm) {
      rowPxHa = utmPixelHa;
    } else {
      const mpLat = 111132.954 - 559.822 * Math.cos((2 * y * Math.PI) / 180);
      const mpLon = 111412.84 * Math.cos((y * Math.PI) / 180);
      rowPxHa = Math.abs(resX * mpLon * resY * mpLat) / 10000.0;
    }

    for (let i = 0; i < width; i++) {
      const x = minX + (i + 0.5) * resX;
      if (x < gMinX || x > gMaxX) continue; // kolom di luar semua bbox

      // Temukan ring pertama yang mengandung pixel ini
      let matchedKey = null;
      for (let ri = 0; ri < entries.length; ri++) {
        const [bx0, by0, bx1, by1] = bboxes[ri];
        if (x < bx0 || x > bx1 || y < by0 || y > by1) continue;
        if (pointInPolygon(x, y, entries[ri].ring)) {
          matchedKey = entries[ri].key;
          break;
        }
      }
      if (!matchedKey) continue;

      const val = data[j * width + i];
      if (
        val === undefined ||
        val === null ||
        Number.isNaN(val) ||
        val === nodata ||
        val === 0
      )
        continue;

      total[val] = (total[val] || 0) + rowPxHa;
      byNama[matchedKey].classCounts[val] =
        (byNama[matchedKey].classCounts[val] || 0) + rowPxHa;
    }
  }
  return { total, byNama };
}

// ── RASTER → CANVAS OVERLAY ──────────────────────────────────
async function addRasterOverlayToMap(raster, mapInstance) {
  if (!mapInstance) return null;

  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext("2d");
  const imgD = ctx.createImageData(raster.width, raster.height);

  const avgPxHa = computeAvgPixelAreaHa(raster);
  const colCache = new Map(); // pixelValue → [r,g,b]

  // Pre-build color lookup dari LANDCOVER_CLASS_VALUES agar tidak parse hex tiap piksel
  const colorLookup = new Map();
  for (const [code, cls] of Object.entries(
    typeof LANDCOVER_CLASS_VALUES !== "undefined" ? LANDCOVER_CLASS_VALUES : {},
  )) {
    const c = cls.color || "#555555";
    colorLookup.set(Number(code), [
      parseInt(c.slice(1, 3), 16),
      parseInt(c.slice(3, 5), 16),
      parseInt(c.slice(5, 7), 16),
    ]);
  }

  // Proses dalam chunks agar browser tidak freeze
  const CHUNK = 200; // baris per yield
  for (let j = 0; j < raster.height; j++) {
    if (j % CHUNK === 0 && j > 0) {
      await new Promise((r) => setTimeout(r, 0)); // yield ke browser
    }
    for (let i = 0; i < raster.width; i++) {
      const idx = j * raster.width + i;
      const val = raster.data[idx];
      if (
        val === raster.nodata ||
        val === 0 ||
        val === undefined ||
        Number.isNaN(val)
      ) {
        imgD.data[idx * 4 + 3] = 0;
        continue;
      }
      let rgb = colCache.get(val);
      if (rgb === undefined) {
        const code = findClassCodeByPixelValue(val, avgPxHa);
        rgb =
          code !== null && colorLookup.has(code)
            ? colorLookup.get(code)
            : [85, 85, 85];
        colCache.set(val, rgb);
      }
      imgD.data[idx * 4 + 0] = rgb[0];
      imgD.data[idx * 4 + 1] = rgb[1];
      imgD.data[idx * 4 + 2] = rgb[2];
      imgD.data[idx * 4 + 3] = 180;
    }
  }
  ctx.putImageData(imgD, 0, 0);

  const [minLon, minLat, maxLon, maxLat] = getBboxWgs84(raster);
  const url = canvas.toDataURL();
  return L.imageOverlay(
    url,
    [
      [minLat, minLon],
      [maxLat, maxLon],
    ],
    { opacity: 0.75, interactive: false },
  ).addTo(mapInstance);
}

// ── GET RASTER BBOX AS LEAFLET BOUNDS (always WGS84) ────────
function getRasterBounds(raster) {
  const [minLon, minLat, maxLon, maxLat] = getBboxWgs84(raster);
  return [
    [minLat, minLon],
    [maxLat, maxLon],
  ];
}

// ── LOAD DEM GeoTIFF ─────────────────────────────────────────
async function loadDemTiff(file) {
  if (!window.GeoTIFF) throw new Error("GeoTIFF library not loaded.");
  const arrayBuffer = await file.arrayBuffer();
  const tiff = await window.GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();
  const rasters = await image.readRasters({ interleave: true });
  const bbox = image.getBoundingBox();
  const width = image.getWidth();
  const height = image.getHeight();
  const nodata = image.fileDirectory?.GDAL_NODATA
    ? parseFloat(image.fileDirectory.GDAL_NODATA)
    : -9999;
  const crs = detectGeoTiffCrs(image);
  return {
    fileName: file.name,
    width,
    height,
    bbox,
    data: rasters,
    nodata,
    isDEM: true,
    crs,
  };
}

// ── CLASSIFY DEM BY ELEVATION ─────────────────────────────────
// Returns { lowland: areaHa, highland: areaHa }
// polygons = null (scan all) | [[lng,lat],...] single ring | [[[lng,lat],...], ...] multi-ring
async function classifyDemByElevation(dem, threshold, polygons) {
  const [minX, minY, maxX, maxY] = dem.bbox;
  const { width, height, data, nodata } = dem;
  const resX = (maxX - minX) / width;
  const resY = (maxY - minY) / height;
  const isUtm = dem.crs?.type === "utm";
  // Gunakan ukuran pixel aktual DEM (resX × resY dalam m²) — bukan konstanta KLHK
  // DEM 100m resolusi: 100×100 = 10.000 m² = 1.0 ha/pixel
  const utmPixelHa = isUtm ? Math.abs(resX * resY) / 10000 : 0;
  // Handle nodata value besar (float32 -3.4e38)
  const nodataThresh = nodata !== undefined && nodata < -1e30 ? -1e30 : -1e10;
  let lowland = 0,
    highland = 0;

  // Normalize polygons → array of rings in DEM coordinate space
  let ringBboxes = null;
  if (polygons) {
    // Detect: single ring [[lng,lat],...] or array of rings [[[lng,lat],...],...]
    const rawRings = Array.isArray(polygons[0][0]) ? polygons : [polygons];
    const converted = rawRings.map((ring) => {
      if (isUtm) {
        const { zone } = dem.crs;
        return ring.map(([lng, lat]) => {
          const u = wgs84ToUtmPoint(lat, lng, zone);
          return [u.easting, u.northing];
        });
      }
      return ring; // WGS84 stays as-is
    });
    // Precompute bbox per ring for fast pre-filter
    ringBboxes = converted.map((ring) => {
      let rx0 = Infinity,
        rx1 = -Infinity,
        ry0 = Infinity,
        ry1 = -Infinity;
      for (const [x, y] of ring) {
        if (x < rx0) rx0 = x;
        if (x > rx1) rx1 = x;
        if (y < ry0) ry0 = y;
        if (y > ry1) ry1 = y;
      }
      return { ring, rx0, rx1, ry0, ry1 };
    });
  }

  // Check if point (x,y) is inside any ring (bbox pre-filter → fast)
  function insideAny(x, y) {
    if (!ringBboxes) return true;
    for (const rb of ringBboxes) {
      if (x >= rb.rx0 && x <= rb.rx1 && y >= rb.ry0 && y <= rb.ry1) {
        if (pointInPolygon(x, y, rb.ring)) return true;
      }
    }
    return false;
  }

  const CHUNK = 300;
  for (let j = 0; j < height; j++) {
    if (j % CHUNK === 0 && j > 0) await new Promise((r) => setTimeout(r, 0));
    const y = maxY - (j + 0.5) * resY;
    let pxHa;
    if (isUtm) {
      pxHa = utmPixelHa;
    } else {
      const mpLat = 111132.954 - 559.822 * Math.cos((2 * y * Math.PI) / 180);
      const mpLon = 111412.84 * Math.cos((y * Math.PI) / 180);
      pxHa = Math.abs(resX * mpLon * resY * mpLat) / 10000.0;
    }

    for (let i = 0; i < width; i++) {
      const x = minX + (i + 0.5) * resX;
      if (!insideAny(x, y)) continue;
      const elev = data[j * width + i];
      // Skip pixel nodata (termasuk nilai besar negatif -3.4e38) dan nilai invalid
      if (
        elev === undefined ||
        elev === null ||
        Number.isNaN(elev) ||
        elev < nodataThresh
      )
        continue;
      // Elevasi ≥ threshold → highland, sisanya (termasuk ≤ 0) → lowland
      if (elev >= threshold) highland += pxHa;
      else lowland += pxHa;
    }
  }
  return { lowland, highland };
}

// ── DEM MAP OVERLAY — Tutupan Lahan IPCC ─────────────────────
// Lowland  (<threshold) : #22a755 hijau vivid  — Tropical Rain Forest
// Highland (>=threshold): #7c3aed ungu vivid   — Tropical Mountain Systems
// Skip pixel nilai 0/nodata (area hitam di QGIS) + pixel-mask dengan SHP
async function addDemOverlayToMap(dem, mapInstance, threshold, clipRings) {
  if (!mapInstance) return null;
  const [minLon, minLat, maxLon, maxLat] = getBboxWgs84(dem);
  const canvas = document.createElement("canvas");
  canvas.width = dem.width;
  canvas.height = dem.height;
  const ctx = canvas.getContext("2d");
  const imgD = ctx.createImageData(dem.width, dem.height);

  // Konversi clipRings [lng,lat] → koordinat pixel canvas
  // Untuk UTM raster: WGS84 → UTM → pixel (menggunakan bbox UTM asli)
  // Untuk WGS84 raster: linear mapping dari bbox WGS84
  let maskRings = null;
  if (clipRings && clipRings.length) {
    if (dem.crs?.type === "utm") {
      const [bMinX, bMinY, bMaxX, bMaxY] = dem.bbox;
      const resX = (bMaxX - bMinX) / dem.width;
      const resY = (bMaxY - bMinY) / dem.height;
      const { zone } = dem.crs;
      maskRings = clipRings.map((ring) =>
        ring.map(([lng, lat]) => {
          const u = wgs84ToUtmPoint(lat, lng, zone);
          return [
            (u.easting - bMinX) / resX, // pixel column
            (bMaxY - u.northing) / resY, // pixel row
          ];
        }),
      );
    } else {
      const lonSpan = maxLon - minLon;
      const latSpan = maxLat - minLat;
      maskRings = clipRings.map((ring) =>
        ring.map(([lng, lat]) => [
          ((lng - minLon) / lonSpan) * dem.width,
          ((maxLat - lat) / latSpan) * dem.height,
        ]),
      );
    }
  }

  const CHUNK = 200;
  // Handle nodata value besar (float32 -3.4e38)
  const nodataThresh =
    dem.nodata !== undefined && dem.nodata < -1e30 ? -1e30 : -1e10;

  for (let j = 0; j < dem.height; j++) {
    if (j % CHUNK === 0 && j > 0) await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < dem.width; i++) {
      const idx = j * dem.width + i;
      const elev = dem.data[idx];

      // Buang area hitam: nodata (termasuk -3.4e38), NaN, undefined, <= 0
      if (
        elev === undefined ||
        elev === null ||
        Number.isNaN(elev) ||
        elev < nodataThresh ||
        elev <= 0
      ) {
        imgD.data[idx * 4 + 3] = 0;
        continue;
      }

      // Pixel-level clip ke SHP polygon
      if (maskRings) {
        const inside = maskRings.some((ring) => pointInPolygon(i, j, ring));
        if (!inside) {
          imgD.data[idx * 4 + 3] = 0;
          continue;
        }
      }

      // Warnai berdasarkan elevasi
      // Lowland  (<threshold) → hijau vivid  #22a755 = (34,167,85)
      // Highland (≥threshold) → ungu vivid   #7c3aed = (124,58,237)
      if (elev < threshold) {
        imgD.data[idx * 4 + 0] = 34;
        imgD.data[idx * 4 + 1] = 167;
        imgD.data[idx * 4 + 2] = 85;
      } else {
        imgD.data[idx * 4 + 0] = 124;
        imgD.data[idx * 4 + 1] = 58;
        imgD.data[idx * 4 + 2] = 237;
      }
      imgD.data[idx * 4 + 3] = 210;
    }
  }
  ctx.putImageData(imgD, 0, 0);

  return L.imageOverlay(
    canvas.toDataURL(),
    [
      [minLat, minLon],
      [maxLat, maxLon],
    ],
    { opacity: 0.85, interactive: false },
  ).addTo(mapInstance);
}

// ── PARSE SHAPEFILE (.zip containing .shp + .dbf + .prj) ──────
// Requires shpjs CDN (window.shp)
async function loadShapefile(file) {
  if (!window.shp) throw new Error("shpjs library not loaded.");
  const arrayBuffer = await file.arrayBuffer();
  const geojson = await window.shp(arrayBuffer);
  const features = Array.isArray(geojson)
    ? geojson[0].features
    : geojson.features;
  if (!features || !features.length)
    throw new Error("Tidak ada fitur dalam shapefile.");

  const rings = [];
  features.forEach((f) => {
    const geom = f.geometry;
    if (!geom) return;
    if (geom.type === "Polygon") {
      rings.push(geom.coordinates[0]);
    } else if (geom.type === "MultiPolygon") {
      geom.coordinates.forEach((poly) => rings.push(poly[0]));
    }
  });
  if (!rings.length) throw new Error("Tidak ada polygon dalam shapefile.");
  return rings; // Array of [[lng, lat], ...] rings
}

// ── LOAD NDVI GeoTIFF ─────────────────────────────────────────
// Expects float32 raster with NDVI values (-1 to 1)
async function loadNdviTiff(file) {
  if (!window.GeoTIFF) throw new Error("GeoTIFF library not loaded.");
  const arrayBuffer = await file.arrayBuffer();
  const tiff = await window.GeoTIFF.fromArrayBuffer(arrayBuffer);
  const image = await tiff.getImage();
  const rasters = await image.readRasters({ interleave: true });
  const bbox = image.getBoundingBox();
  const width = image.getWidth();
  const height = image.getHeight();
  const nodata = image.fileDirectory?.GDAL_NODATA
    ? parseFloat(image.fileDirectory.GDAL_NODATA)
    : -9999;
  return {
    fileName: file.name,
    width,
    height,
    bbox,
    data: rasters,
    nodata,
    isNDVI: true,
  };
}

// ── LOAD NDVI FROM ARRAYBUFFER (GEE response) ─────────────────
// Same as loadNdviTiff but accepts a raw ArrayBuffer instead of a File
async function loadNdviTiffFromBuffer(buffer, fileName) {
  if (!window.GeoTIFF) throw new Error("GeoTIFF library not loaded.");
  const tiff = await window.GeoTIFF.fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const rasters = await image.readRasters({ interleave: true });
  const bbox = image.getBoundingBox();
  const width = image.getWidth();
  const height = image.getHeight();
  const nodata = image.fileDirectory?.GDAL_NODATA
    ? parseFloat(image.fileDirectory.GDAL_NODATA)
    : -9999;
  return {
    fileName: fileName || "ndvi_gee.tif",
    width,
    height,
    bbox,
    data: rasters,
    nodata,
    isNDVI: true,
  };
}

// ── LOAD NDVI DARI FILE LOKAL (NDVI/YYYY.tif) ──────────────
// Membaca file NDVI GeoTIFF dari folder lokal via URL
// Mendukung CRS WGS84 maupun UTM (deteksi otomatis)
// COG (Cloud Optimized GeoTIFF): gunakan fromUrl() → HTTP range request,
// hanya tile yang diperlukan yang didownload (efisien untuk file besar).
// Non-COG / BigTIFF: fallback ke fetch+ArrayBuffer (load penuh).
async function loadNdviFromLocalAsset(url, fileName) {
  if (!window.GeoTIFF) throw new Error("GeoTIFF library not loaded.");

  let tiff;
  // Coba fromUrl() dulu — efisien untuk COG (HTTP range request, lazy tile load)
  // Fallback ke fetch+ArrayBuffer untuk file non-COG / BigTIFF lama
  try {
    tiff = await window.GeoTIFF.fromUrl(url);
  } catch (_cogErr) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
    const buffer = await resp.arrayBuffer();
    tiff = await window.GeoTIFF.fromArrayBuffer(buffer);
  }

  const image = await tiff.getImage();
  const rasters = await image.readRasters({ interleave: true });
  const bbox = image.getBoundingBox();
  const width = image.getWidth();
  const height = image.getHeight();
  const nodataRaw = image.fileDirectory?.GDAL_NODATA;
  const nodata = nodataRaw ? parseFloat(nodataRaw) : -9999;
  const crs = detectGeoTiffCrs(image);
  return {
    fileName: fileName || url.split("/").pop(),
    width,
    height,
    bbox,
    data: rasters,
    nodata,
    isNDVI: true,
    crs,
  };
}

// ── PROCESS NDVI RASTER → CARBON CLASSES (Literature / Lefebvre) ────────────
//
// Metodologi per-piksel:
//   1. Baca nilai NDVI tiap pixel (handle integer ×10000 secara otomatis)
//   2. Hitung luas pixel [ha]:
//        UTM  : pixelAreaHa = |resX_m × resY_m| / 10.000
//        WGS84: pixelAreaHa = |resX_deg × mpLon × resY_deg × mpLat| / 10.000
//              mpLon = 111.412,84 × cos(lat) m/° ; mpLat = 111.132,95 - 559,82 × cos(2lat) m/°
//   3. Hitung densitas karbon per piksel [tC/ha]:
//        carbonDensity = max(0, -255.61 × NDVI² + 494.84 × NDVI - 154.45)
//        (Formula Lefebvre/Sentinel-2 regression, R²=0.8574)
//   4. Hitung karbon piksel [tC]:
//        carbonPixel = carbonDensity × pixelAreaHa
//   5. Akumulasi: totalAreaHa += pixelAreaHa ; totalCarbon += carbonPixel
//   6. Klasifikasi NDVI → 3 kelas stok karbon:
//        NDVI ≥ 0.65 → lit_high   (Stok Karbon Tinggi)
//        NDVI ≥ 0.50 → lit_medium (Stok Karbon Sedang)
//        NDVI < 0.50 → lit_low    (Stok Karbon Rendah)
//
// Returns { areaHa, totalCarbon, meanNdvi, classCounts, classCarbons }
//   areaHa       : total luas area valid [ha]
//   totalCarbon  : total stok karbon = Σ (carbonDensity × pixelAreaHa) [tC]
//   meanNdvi     : rata-rata NDVI semua pixel valid
//   classCounts  : { lit_high, lit_medium, lit_low } → luas per kelas [ha]
//   classCarbons : { lit_high, lit_medium, lit_low } → karbon per kelas [tC]
// polygons = null (scan all) | [[lng,lat],...] single ring | [[[lng,lat],...], ...] multi-ring
async function processNdviRaster(ndvi, polygons) {
  const [minX, minY, maxX, maxY] = ndvi.bbox;
  const { width, height, data, nodata } = ndvi;
  const resX = (maxX - minX) / width;
  const resY = (maxY - minY) / height;
  const isUtm = ndvi.crs?.type === "utm";
  const utmPixelHa = isUtm ? Math.abs(resX * resY) / 10000 : 0;

  // Normalize polygons → array of rings in raster coordinate space (bbox pre-filter)
  let ringBboxes = null;
  if (polygons) {
    const rawRings = Array.isArray(polygons[0][0]) ? polygons : [polygons];
    const converted = rawRings.map((ring) => {
      if (isUtm) {
        const { zone } = ndvi.crs;
        return ring.map(([lng, lat]) => {
          const u = wgs84ToUtmPoint(lat, lng, zone);
          return [u.easting, u.northing];
        });
      }
      return ring;
    });
    ringBboxes = converted.map((ring) => {
      let rx0 = Infinity,
        rx1 = -Infinity,
        ry0 = Infinity,
        ry1 = -Infinity;
      for (const [x, y] of ring) {
        if (x < rx0) rx0 = x;
        if (x > rx1) rx1 = x;
        if (y < ry0) ry0 = y;
        if (y > ry1) ry1 = y;
      }
      return { ring, rx0, rx1, ry0, ry1 };
    });
  }

  function insideAny(cx, cy) {
    if (!ringBboxes) return true;
    for (const rb of ringBboxes) {
      if (cx >= rb.rx0 && cx <= rb.rx1 && cy >= rb.ry0 && cy <= rb.ry1) {
        if (pointInPolygon(cx, cy, rb.ring)) return true;
      }
    }
    return false;
  }

  let totalAreaHa = 0,
    totalCarbon = 0,
    sumNdvi = 0,
    pixelCount = 0;
  const classCounts = { lit_high: 0, lit_medium: 0, lit_low: 0 };
  const classCarbons = { lit_high: 0, lit_medium: 0, lit_low: 0 };

  const CHUNK = 300;
  for (let j = 0; j < height; j++) {
    if (j % CHUNK === 0 && j > 0) await new Promise((r) => setTimeout(r, 0));
    const cy = maxY - (j + 0.5) * resY;
    let rowPxHa;
    if (isUtm) {
      rowPxHa = utmPixelHa;
    } else {
      const mpLat = 111132.954 - 559.822 * Math.cos((2 * cy * Math.PI) / 180);
      const mpLon = 111412.84 * Math.cos((cy * Math.PI) / 180);
      rowPxHa = Math.abs(resX * mpLon * resY * mpLat) / 10000.0;
    }

    for (let i = 0; i < width; i++) {
      const cx = minX + (i + 0.5) * resX;
      if (!insideAny(cx, cy)) continue;

      let v = data[j * width + i];
      if (
        v === undefined ||
        v === null ||
        Number.isNaN(v) ||
        Math.abs(v - nodata) < 0.001
      )
        continue;

      // Handle NDVI integer ×10000 (format int16 dari process_ndvi.py)
      if (Math.abs(v) > 1) v = v / 10000;
      if (v < -1 || v > 1) continue;

      // Formula Lefebvre/Sentinel-2: y = -255.61x² + 494.84x - 154.45
      const carbonDensity = ndviToCarbon(v);
      const carbonPixel = carbonDensity * rowPxHa;
      const key = v >= 0.65 ? "lit_high" : v >= 0.5 ? "lit_medium" : "lit_low";

      totalAreaHa += rowPxHa;
      totalCarbon += carbonPixel;
      sumNdvi += v;
      pixelCount += 1;
      classCounts[key] += rowPxHa;
      classCarbons[key] += carbonPixel;
    }
  }

  return {
    areaHa: totalAreaHa,
    totalCarbon,
    meanNdvi: pixelCount > 0 ? sumNdvi / pixelCount : 0,
    classCounts,
    classCarbons,
  };
}

// ── PROCESS STOCK CARBON RASTER (Literature — Landsat 8 pre-computed) ────────
// Membaca raster stok karbon Landsat 8 yang sudah pre-computed (tC/ha per pixel).
// Melakukan sampling per fitur hutan.shp untuk breakdown Per Nama Hutan.
//
// Returns:
//   { totalCarbon, totalAreaHa, byNama: [{nama, color, carbon, areaHa}] }
//
// nfiFeatures = array GeoJSON features dari hutan.shp (dengan properties.namobj & _namaColor)
async function processStockCarbonRaster(raster, nfiFeatures) {
  const [minX, minY, maxX, maxY] = raster.bbox;
  const { width, height, data, nodata } = raster;
  const resX = (maxX - minX) / width;
  const resY = (maxY - minY) / height;
  const isUtm = raster.crs?.type === "utm";
  const pixelAreaHa = isUtm ? Math.abs(resX * resY) / 10000 : 0;

  // Threshold nodata — float32 raster dari GEE pakai -3.4e38
  const nodataThresh = nodata !== undefined && nodata < -1e30 ? -1e30 : -1e10;

  // ── Siapkan data per fitur dalam koordinat raster ─────────────
  const featureData = [];
  if (nfiFeatures && nfiFeatures.length) {
    for (const feat of nfiFeatures) {
      const nama = feat.properties?.namobj || feat.properties?.NAMOBJ || "–";
      const color = feat._namaColor || "#4caf50";
      const geom = feat.geometry;
      if (!geom) continue;

      let rawRings = [];
      if (geom.type === "Polygon") rawRings = [geom.coordinates[0]];
      else if (geom.type === "MultiPolygon")
        rawRings = geom.coordinates.map((p) => p[0]);
      if (!rawRings.length) continue;

      // Konversi ke koordinat raster (UTM)
      const rasterRings = rawRings.map((ring) => {
        if (isUtm) {
          const { zone } = raster.crs;
          return ring.map(([lng, lat]) => {
            const u = wgs84ToUtmPoint(lat, lng, zone);
            return [u.easting, u.northing];
          });
        }
        return ring;
      });

      // Pre-compute bbox per ring untuk fast pre-filter
      const ringBboxes = rasterRings.map((ring) => {
        let rx0 = Infinity,
          rx1 = -Infinity,
          ry0 = Infinity,
          ry1 = -Infinity;
        for (const [x, y] of ring) {
          if (x < rx0) rx0 = x;
          if (x > rx1) rx1 = x;
          if (y < ry0) ry0 = y;
          if (y > ry1) ry1 = y;
        }
        return { ring, rx0, rx1, ry0, ry1 };
      });

      featureData.push({ nama, color, ringBboxes, carbon: 0, areaHa: 0 });
    }
  }

  let totalCarbon = 0,
    totalAreaHa = 0;

  const CHUNK = 200;
  for (let j = 0; j < height; j++) {
    if (j % CHUNK === 0 && j > 0) await new Promise((r) => setTimeout(r, 0));
    const cy = maxY - (j + 0.5) * resY;

    let rowPixelHa;
    if (isUtm) {
      rowPixelHa = pixelAreaHa;
    } else {
      const mpLat = 111132.954 - 559.822 * Math.cos((2 * cy * Math.PI) / 180);
      const mpLon = 111412.84 * Math.cos((cy * Math.PI) / 180);
      rowPixelHa = Math.abs(resX * mpLon * resY * mpLat) / 10000.0;
    }

    for (let i = 0; i < width; i++) {
      const cx = minX + (i + 0.5) * resX;
      const v = data[j * width + i];

      // Skip nodata / invalid
      if (
        v === undefined ||
        v === null ||
        Number.isNaN(v) ||
        v < nodataThresh ||
        v < -10
      )
        continue;

      // Cocokkan pixel ke fitur (non-overlapping → ambil fitur pertama yang match)
      let matched = null;
      for (const fd of featureData) {
        for (const rb of fd.ringBboxes) {
          if (cx >= rb.rx0 && cx <= rb.rx1 && cy >= rb.ry0 && cy <= rb.ry1) {
            if (pointInPolygon(cx, cy, rb.ring)) {
              matched = fd;
              break;
            }
          }
        }
        if (matched) break;
      }

      if (!matched) continue; // pixel di luar semua fitur hutan

      const pixelCarbon = v * rowPixelHa; // tC/ha × ha = tC
      matched.carbon += pixelCarbon;
      matched.areaHa += rowPixelHa;
      totalCarbon += pixelCarbon;
      totalAreaHa += rowPixelHa;
    }
  }

  return {
    totalCarbon,
    totalAreaHa,
    byNama: featureData
      .filter((fd) => fd.areaHa > 0)
      .map((fd) => ({
        nama: fd.nama,
        color: fd.color,
        carbon: fd.carbon,
        areaHa: fd.areaHa,
      })),
  };
}

// ── STOCK CARBON → MAP OVERLAY (Literature) ───────────────────
// Gradient hijau muda (karbon rendah) → hijau tua (karbon tinggi), clipped ke SHP
async function addStockCarbonOverlay(raster, mapInstance, clipRings) {
  if (!mapInstance) return null;
  const [minLon, minLat, maxLon, maxLat] = getBboxWgs84(raster);
  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext("2d");
  const imgD = ctx.createImageData(raster.width, raster.height);

  const isUtm = raster.crs?.type === "utm";
  const nodataThresh = raster.nodata < -1e30 ? -1e30 : -1e10;

  // First pass: cari range nilai valid untuk normalisasi warna
  let minV = Infinity,
    maxV = -Infinity;
  for (let k = 0; k < raster.width * raster.height; k++) {
    const v = raster.data[k];
    if (
      v === undefined ||
      v === null ||
      Number.isNaN(v) ||
      v < nodataThresh ||
      v < -10
    )
      continue;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const vRange = maxV - minV || 1;

  // Siapkan mask rings (pixel space)
  let maskRings = null;
  if (clipRings && clipRings.length) {
    if (isUtm) {
      const [bMinX, , bMaxX, bMaxY] = raster.bbox;
      const resX = (bMaxX - bMinX) / raster.width;
      const resY = (raster.bbox[3] - raster.bbox[1]) / raster.height;
      const { zone } = raster.crs;
      maskRings = clipRings.map((ring) =>
        ring.map(([lng, lat]) => {
          const u = wgs84ToUtmPoint(lat, lng, zone);
          return [(u.easting - bMinX) / resX, (bMaxY - u.northing) / resY];
        }),
      );
    } else {
      maskRings = clipRings.map((ring) =>
        ring.map(([lng, lat]) => [
          ((lng - minLon) / (maxLon - minLon)) * raster.width,
          ((maxLat - lat) / (maxLat - minLat)) * raster.height,
        ]),
      );
    }
  }

  const CHUNK = 200;
  for (let j = 0; j < raster.height; j++) {
    if (j % CHUNK === 0 && j > 0) await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < raster.width; i++) {
      const idx = j * raster.width + i;
      const v = raster.data[idx];
      if (
        v === undefined ||
        v === null ||
        Number.isNaN(v) ||
        v < nodataThresh ||
        v < -10
      )
        continue;

      // Mask SHP
      if (maskRings) {
        const inAny = maskRings.some((ring) =>
          pointInPolygon(i + 0.5, j + 0.5, ring),
        );
        if (!inAny) continue;
      }

      // Normalisasi 0–1 → gradient hijau muda (#c8e6c9) → hijau tua (#1b5e20)
      const t = Math.max(0, Math.min(1, (v - minV) / vRange));
      const r = Math.round(200 - t * 173); // 200→27
      const g = Math.round(230 - t * 136); // 230→94
      const b = Math.round(200 - t * 168); // 200→32

      const base = idx * 4;
      imgD.data[base] = r;
      imgD.data[base + 1] = g;
      imgD.data[base + 2] = b;
      imgD.data[base + 3] = 210;
    }
  }

  ctx.putImageData(imgD, 0, 0);
  return window.L.imageOverlay(canvas.toDataURL(), [
    [minLat, minLon],
    [maxLat, maxLon],
  ]).addTo(mapInstance);
}

// ── NDVI → CARBON COLOR OVERLAY ───────────────────────────────
// Smooth gradient: hijau muda (rendah) → hijau tua (tinggi), clipped to SHP
async function addNdviOverlayToMap(ndvi, mapInstance, clipRings) {
  if (!mapInstance) return null;
  const canvas = document.createElement("canvas");
  canvas.width = ndvi.width;
  canvas.height = ndvi.height;
  const ctx = canvas.getContext("2d");
  const imgD = ctx.createImageData(ndvi.width, ndvi.height);

  // First pass: find carbon range for normalization
  let minC = Infinity,
    maxC = -Infinity;
  for (let k = 0; k < ndvi.width * ndvi.height; k++) {
    let v = ndvi.data[k];
    if (
      v === undefined ||
      v === null ||
      Number.isNaN(v) ||
      Math.abs(v - ndvi.nodata) < 0.001
    )
      continue;
    if (Math.abs(v) > 1) v = v / 10000;
    if (v < -1 || v > 1) continue;
    const c = ndviToCarbon(v);
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  const range = maxC - minC || 1;

  // Build clip mask rings (pixel coords)
  const [bMinX, bMinY, bMaxX, bMaxY] = ndvi.bbox;
  const bResX = (bMaxX - bMinX) / ndvi.width;
  const bResY = (bMaxY - bMinY) / ndvi.height;
  const bIsUtm = ndvi.crs?.type === "utm";
  let carbonMaskRings = null;
  if (clipRings && clipRings.length) {
    if (bIsUtm) {
      const { zone } = ndvi.crs;
      carbonMaskRings = clipRings.map((ring) =>
        ring.map(([lng, lat]) => {
          const u = wgs84ToUtmPoint(lat, lng, zone);
          return [(u.easting - bMinX) / bResX, (bMaxY - u.northing) / bResY];
        }),
      );
    } else {
      carbonMaskRings = clipRings.map((ring) =>
        ring.map(([lng, lat]) => [
          (lng - bMinX) / bResX,
          (bMaxY - lat) / bResY,
        ]),
      );
    }
  }

  const CHUNK = 200;
  for (let j = 0; j < ndvi.height; j++) {
    if (j % CHUNK === 0 && j > 0) await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < ndvi.width; i++) {
      const idx = j * ndvi.width + i;

      if (carbonMaskRings) {
        const inside = carbonMaskRings.some((ring) =>
          pointInPolygon(i, j, ring),
        );
        if (!inside) {
          imgD.data[idx * 4 + 3] = 0;
          continue;
        }
      }

      let v = ndvi.data[idx];
      if (
        v === undefined ||
        v === null ||
        Number.isNaN(v) ||
        Math.abs(v - ndvi.nodata) < 0.001
      ) {
        imgD.data[idx * 4 + 3] = 0;
        continue;
      }
      if (Math.abs(v) > 1) v = v / 10000;
      if (v < -1 || v > 1) {
        imgD.data[idx * 4 + 3] = 0;
        continue;
      }

      const c = ndviToCarbon(v);
      const t = Math.max(0, Math.min(1, (c - minC) / range));
      imgD.data[idx * 4] = Math.round(200 + t * (13 - 200));
      imgD.data[idx * 4 + 1] = Math.round(230 + t * (74 - 230));
      imgD.data[idx * 4 + 2] = Math.round(201 + t * (39 - 201));
      imgD.data[idx * 4 + 3] = 185;
    }
  }
  ctx.putImageData(imgD, 0, 0);

  const [minLon3, minLat3, maxLon3, maxLat3] = getBboxWgs84(ndvi);
  const url = canvas.toDataURL();
  return L.imageOverlay(
    url,
    [
      [minLat3, minLon3],
      [maxLat3, maxLon3],
    ],
    {
      opacity: 0.8,
      interactive: false,
    },
  ).addTo(mapInstance);
}

// ── KLHK CARBON DENSITY OVERLAY ──────────────────────────────
// 3-stop gradasi hijau: muda (#e8f5e9) → vivid (#43a047) → tua (#1b5e20)
async function addCarbonDensityOverlay(raster, classData, mapInstance) {
  if (!mapInstance || !raster || !classData) return null;

  // Build code → carbon density (tC/ha)
  const densityMap = {};
  let minD = Infinity,
    maxD = -Infinity;
  for (const [code, d] of Object.entries(classData)) {
    const density = d.areaHa > 0 ? d.carbon / d.areaHa : 0;
    densityMap[String(code)] = density;
    if (density < minD) minD = density;
    if (density > maxD) maxD = density;
  }
  const range = maxD - minD || 1;

  const canvas = document.createElement("canvas");
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext("2d");
  const imgD = ctx.createImageData(raster.width, raster.height);

  const CHUNK = raster.width * 200; // yield setiap 200 baris
  for (let idx = 0; idx < raster.width * raster.height; idx++) {
    if (idx > 0 && idx % CHUNK === 0)
      await new Promise((r) => setTimeout(r, 0));
    const val = raster.data[idx];
    if (
      val === raster.nodata ||
      val === 0 ||
      val === undefined ||
      val === null
    ) {
      imgD.data[idx * 4 + 3] = 0;
      continue;
    }
    const density = densityMap[String(val)] ?? 0;
    const t = Math.max(0, Math.min(1, (density - minD) / range));
    // 3-stop hijau: muda (#e8f5e9=232,245,233) → vivid (#43a047=67,160,71) → tua (#1b5e20=27,94,32)
    let r, g, b;
    if (t <= 0.5) {
      const s = t * 2;
      r = Math.round(232 + s * (67 - 232));
      g = Math.round(245 + s * (160 - 245));
      b = Math.round(233 + s * (71 - 233));
    } else {
      const s = (t - 0.5) * 2;
      r = Math.round(67 + s * (27 - 67));
      g = Math.round(160 + s * (94 - 160));
      b = Math.round(71 + s * (32 - 71));
    }
    imgD.data[idx * 4 + 0] = r;
    imgD.data[idx * 4 + 1] = g;
    imgD.data[idx * 4 + 2] = b;
    imgD.data[idx * 4 + 3] = 210;
  }
  ctx.putImageData(imgD, 0, 0);

  const [minLon, minLat, maxLon, maxLat] = getBboxWgs84(raster);
  return L.imageOverlay(
    canvas.toDataURL(),
    [
      [minLat, minLon],
      [maxLat, maxLon],
    ],
    { opacity: 0.85, interactive: false },
  ).addTo(mapInstance);
}

// ── IPCC CARBON DENSITY OVERLAY ──────────────────────────────
// Gradasi hijau muda→tua per pixel DEM, di-mask dengan clipRings
async function addIpccCarbonOverlay(
  dem,
  classData,
  threshold,
  mapInstance,
  clipRings,
) {
  if (!mapInstance || !dem || !classData) return null;

  const lowDensity = classData["tropical_rainforest"]
    ? classData["tropical_rainforest"].carbon /
      (classData["tropical_rainforest"].areaHa || 1)
    : 479.5;
  const highDensity = classData["tropical_mountain"]
    ? classData["tropical_mountain"].carbon /
      (classData["tropical_mountain"].areaHa || 1)
    : 260.4;
  const minD = Math.min(lowDensity, highDensity);
  const maxD = Math.max(lowDensity, highDensity);
  const range = maxD - minD || 1;

  const [minLon, minLat, maxLon, maxLat] = getBboxWgs84(dem);
  const canvas = document.createElement("canvas");
  canvas.width = dem.width;
  canvas.height = dem.height;
  const ctx = canvas.getContext("2d");
  const imgD = ctx.createImageData(dem.width, dem.height);

  // Konversi clipRings ke koordinat pixel untuk masking
  // UTM raster: WGS84 → UTM → pixel; WGS84 raster: linear mapping
  let maskRings = null;
  if (clipRings && clipRings.length) {
    if (dem.crs?.type === "utm") {
      const [bMinX, bMinY, bMaxX, bMaxY] = dem.bbox;
      const resX = (bMaxX - bMinX) / dem.width;
      const resY = (bMaxY - bMinY) / dem.height;
      const { zone } = dem.crs;
      maskRings = clipRings.map((ring) =>
        ring.map(([lng, lat]) => {
          const u = wgs84ToUtmPoint(lat, lng, zone);
          return [(u.easting - bMinX) / resX, (bMaxY - u.northing) / resY];
        }),
      );
    } else {
      maskRings = clipRings.map((ring) =>
        ring.map(([lng, lat]) => [
          ((lng - minLon) / (maxLon - minLon)) * dem.width,
          ((maxLat - lat) / (maxLat - minLat)) * dem.height,
        ]),
      );
    }
  }

  const CHUNK = 200;
  // Handle nodata value besar (float32 -3.4e38)
  const nodataThresh =
    dem.nodata !== undefined && dem.nodata < -1e30 ? -1e30 : -1e10;

  for (let j = 0; j < dem.height; j++) {
    if (j % CHUNK === 0 && j > 0) await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < dem.width; i++) {
      const idx = j * dem.width + i;
      const elev = dem.data[idx];
      // Buang area hitam: nodata (termasuk -3.4e38), NaN, undefined, <= 0
      if (
        elev === undefined ||
        elev === null ||
        Number.isNaN(elev) ||
        elev < nodataThresh ||
        elev <= 0
      ) {
        imgD.data[idx * 4 + 3] = 0;
        continue;
      }
      // Pixel-level polygon mask
      if (maskRings) {
        const inside = maskRings.some((ring) => pointInPolygon(i, j, ring));
        if (!inside) {
          imgD.data[idx * 4 + 3] = 0;
          continue;
        }
      }
      const density = elev < threshold ? lowDensity : highDensity;
      const t = Math.max(0, Math.min(1, (density - minD) / range));
      // 3-stop hijau: muda (#e8f5e9=232,245,233) → vivid (#43a047=67,160,71) → tua (#1b5e20=27,94,32)
      let r, g, b;
      if (t <= 0.5) {
        const s = t * 2;
        r = Math.round(232 + s * (67 - 232));
        g = Math.round(245 + s * (160 - 245));
        b = Math.round(233 + s * (71 - 233));
      } else {
        const s = (t - 0.5) * 2;
        r = Math.round(67 + s * (27 - 67));
        g = Math.round(160 + s * (94 - 160));
        b = Math.round(71 + s * (32 - 71));
      }
      imgD.data[idx * 4 + 0] = r;
      imgD.data[idx * 4 + 1] = g;
      imgD.data[idx * 4 + 2] = b;
      imgD.data[idx * 4 + 3] = 210;
    }
  }
  ctx.putImageData(imgD, 0, 0);

  return L.imageOverlay(
    canvas.toDataURL(),
    [
      [minLat, minLon],
      [maxLat, maxLon],
    ],
    { opacity: 0.82, interactive: false },
  ).addTo(mapInstance);
}

// ── NDVI CLASS COLOR OVERLAY (Literature cover view) ──────────
// Colors each pixel by NDVI class, clipped to clipRings (SHP polygon)
// clipRings: Array of [[lng,lat],...] rings in WGS84
async function addNdviClassOverlay(ndvi, mapInstance, clipRings) {
  if (!mapInstance || !ndvi) return null;

  const [minX, minY, maxX, maxY] = ndvi.bbox;
  const resX = (maxX - minX) / ndvi.width;
  const resY = (maxY - minY) / ndvi.height;
  const isUtm = ndvi.crs?.type === "utm";

  // Konversi clipRings ke koordinat pixel canvas untuk masking
  let maskRings = null;
  if (clipRings && clipRings.length) {
    if (isUtm) {
      const { zone } = ndvi.crs;
      maskRings = clipRings.map((ring) =>
        ring.map(([lng, lat]) => {
          const u = wgs84ToUtmPoint(lat, lng, zone);
          return [(u.easting - minX) / resX, (maxY - u.northing) / resY];
        }),
      );
    } else {
      maskRings = clipRings.map((ring) =>
        ring.map(([lng, lat]) => [(lng - minX) / resX, (maxY - lat) / resY]),
      );
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = ndvi.width;
  canvas.height = ndvi.height;
  const ctx = canvas.getContext("2d");
  const imgD = ctx.createImageData(ndvi.width, ndvi.height);

  const CHUNK = 200;
  for (let j = 0; j < ndvi.height; j++) {
    if (j % CHUNK === 0 && j > 0) await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < ndvi.width; i++) {
      const idx = j * ndvi.width + i;

      // Pixel mask — hanya gambar pixel dalam SHP
      if (maskRings) {
        const inside = maskRings.some((ring) => pointInPolygon(i, j, ring));
        if (!inside) {
          imgD.data[idx * 4 + 3] = 0;
          continue;
        }
      }

      let v = ndvi.data[idx];
      if (
        v === undefined ||
        v === null ||
        Number.isNaN(v) ||
        Math.abs(v - ndvi.nodata) < 0.001
      ) {
        imgD.data[idx * 4 + 3] = 0;
        continue;
      }
      if (Math.abs(v) > 1) v = v / 10000;
      if (v < -1 || v > 1) {
        imgD.data[idx * 4 + 3] = 0;
        continue;
      }

      // lit_high=#0d4a27 gelap, lit_medium=#4caf50, lit_low=#c8e6c9 muda
      let r, g, b;
      if (v >= 0.65) {
        r = 13;
        g = 74;
        b = 39;
      } // hijau tua
      else if (v >= 0.5) {
        r = 76;
        g = 175;
        b = 80;
      } // hijau medium
      else {
        r = 200;
        g = 230;
        b = 201;
      } // hijau muda

      imgD.data[idx * 4] = r;
      imgD.data[idx * 4 + 1] = g;
      imgD.data[idx * 4 + 2] = b;
      imgD.data[idx * 4 + 3] = 185;
    }
  }
  ctx.putImageData(imgD, 0, 0);

  const [minLon2, minLat2, maxLon2, maxLat2] = getBboxWgs84(ndvi);
  return L.imageOverlay(
    canvas.toDataURL(),
    [
      [minLat2, minLon2],
      [maxLat2, maxLon2],
    ],
    { opacity: 0.78, interactive: false },
  ).addTo(mapInstance);
}

// ── DISPLAY SHP POLYGON ON MAP ────────────────────────────────
function addShpToMap(rings, mapInstance) {
  if (!mapInstance) return null;
  const leafletRings = rings.map((ring) =>
    ring.map(([lng, lat]) => [lat, lng]),
  );
  const layer = L.polygon(leafletRings, {
    color: "#f2cc8f",
    weight: 2,
    fillOpacity: 0.1,
    fillColor: "#f2cc8f",
  }).addTo(mapInstance);
  mapInstance.fitBounds(layer.getBounds(), { padding: [30, 30] });
  return layer;
}
