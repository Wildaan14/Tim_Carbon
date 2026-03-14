"""
precompute.py — Pre-compute KLHK class counts per namobj per tahun
==================================================================
Jalankan sekali dari folder proyek:
    python precompute.py

Output: mapbiomass/<YYYY>_data.json untuk setiap tahun
Format JSON sama dengan output sampleRasterByFeatures() di JS:
  {
    "year": "2015",
    "total": { "3": 5234.5, ... },            # code → areaHa
    "byNama": {
      "Gunung Halimun Salak": {
        "kelas": "Hutan Konservasi",
        "classCounts": { "3": 1000.5, ... }   # code → areaHa
      }
    }
  }

Setelah JSON tersedia, app.js akan load JSON (instan) alih-alih
memproses TIFF yang berat (beberapa detik).
"""

import json
import os
import sys
import math

# Fix PROJ conflict — set ke bundled PROJ rasterio sebelum import apapun
_RASTERIO_BASE = os.path.join(
    os.path.dirname(sys.executable), "Lib", "site-packages", "rasterio"
)
_PROJ_DIR = os.path.join(_RASTERIO_BASE, "proj_data")
if os.path.isdir(_PROJ_DIR):
    os.environ["PROJ_DATA"] = _PROJ_DIR
    os.environ["PROJ_LIB"]  = _PROJ_DIR
    os.environ["GDAL_DATA"] = os.path.join(_RASTERIO_BASE, "gdal_data")

import numpy as np
import rasterio
from rasterio.mask import mask as rio_mask
import shapefile  # pyshp

# WGS84 WKT (tanpa EPSG lookup agar tidak bergantung proj.db)
WGS84_WKT = (
    'GEOGCS["WGS 84",DATUM["WGS_1984",'
    'SPHEROID["WGS 84",6378137,298.257223563]],'
    'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]'
)

def _ring_area_m2_utm(ring_wgs84, trans):
    """Luas ring (shoelace) setelah diproyeksikan ke UTM (satuan m²)."""
    pts = [trans.transform(lon, lat) for lon, lat in ring_wgs84]
    n = len(pts)
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]
    return abs(area) / 2.0


def geom_area_ha_utm(geom, utm_epsg=32748):
    """Luas WGS84 geometry [ha] menggunakan proyeksi UTM (shoelace)."""
    from pyproj import Transformer
    trans = Transformer.from_crs(4326, utm_epsg, always_xy=True)

    def _poly_ha(rings):
        outer = _ring_area_m2_utm(rings[0], trans)
        holes = sum(_ring_area_m2_utm(r, trans) for r in rings[1:])
        return (outer - holes) / 10_000.0

    gtype = geom.get("type", "")
    coords = geom.get("coordinates", [])
    if gtype == "Polygon":
        return _poly_ha(coords)
    elif gtype == "MultiPolygon":
        return sum(_poly_ha(poly) for poly in coords)
    return 0.0


def transform_geojson(geom, dst_epsg):
    """Transform GeoJSON geometry dict dari WGS84 → dst_epsg via pyproj."""
    from pyproj import Transformer
    trans = Transformer.from_crs(4326, dst_epsg, always_xy=True)

    def _ring(coords):
        return [list(trans.transform(lon, lat)) for lon, lat in coords]

    gtype = geom.get("type", "")
    coords = geom.get("coordinates", [])
    if gtype == "Polygon":
        return {"type": "Polygon", "coordinates": [_ring(r) for r in coords]}
    elif gtype == "MultiPolygon":
        return {"type": "MultiPolygon",
                "coordinates": [[_ring(r) for r in poly] for poly in coords]}
    return geom  # passthrough untuk tipe lain


# ── KONFIGURASI ───────────────────────────────────────────────
# Ukuran pixel mapbiomass (≈ 896 m²)
MAPBIOMASS_PIXEL_AREA_M2 = 896

BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
SHP_PATH    = os.path.join(BASE_DIR, "hutan", "hutan.shp")
TIFF_DIR    = os.path.join(BASE_DIR, "mapbiomass")
YEARS       = list(range(2015, 2025))   # 2015-2024
OUTPUT_DIR  = TIFF_DIR  # simpan JSON di folder yang sama dengan TIFF


# ── LANDCOVER CLASS VALUES (sama dengan data.js) ──────────────
LANDCOVER_CLASS_VALUES = {
    3:  {"agb": 345.46, "bgb": 100.89, "cf": 0.47},  # Forest
    5:  {"agb": 236.17, "bgb":  73.45, "cf": 0.47},  # Mangrove
    13: {"agb":  19.34, "bgb":   4.56, "cf": 0.47},  # Non-forest veg
    21: {"agb":  64.64, "bgb":  12.93, "cf": 0.47},  # Other Agriculture
    24: {"agb":   2.17, "bgb":   0.63, "cf": 0.47},  # Settlement
    25: {"agb":   2.40, "bgb":   0.57, "cf": 0.47},  # Other Non-veg
    30: {"agb":   0.0,  "bgb":   0.0,  "cf": 0.47},  # Mining
    31: {"agb":   0.0,  "bgb":   0.0,  "cf": 0.47},  # Shrimp Pond
    33: {"agb":   0.0,  "bgb":   0.0,  "cf": 0.47},  # River
    35: {"agb":  48.10, "bgb":  15.63, "cf": 0.47},  # Oil Palm
    40: {"agb":  10.0,  "bgb":   2.36, "cf": 0.47},  # Rice Paddy
    15: {"agb":   6.0,  "bgb":   1.2,  "cf": 0.47},  # Pasture (fallback)
}
VALID_CODES = set(LANDCOVER_CLASS_VALUES.keys())


def load_shp_features(shp_path):
    """Return list of { namobj, kelas, geometry_wgs84_as_geojson }"""
    sf = shapefile.Reader(shp_path, encoding="latin-1")
    fields = [f[0].lower() for f in sf.fields[1:]]  # skip DeletionFlag

    features = []
    for rec in sf.shapeRecords():
        props = {fields[i]: rec.record[i] for i in range(len(fields))}
        namobj = (props.get("namobj") or props.get("NAMOBJ") or "Area Hutan").strip()
        kelas  = (props.get("kelas")  or props.get("KELAS")  or "–").strip()

        # Konversi geometry shapefile → GeoJSON dict (WGS84)
        geom = rec.shape.__geo_interface__
        shp_area_ha = geom_area_ha_utm(geom)  # luas polygon UTM 48S (akurat)
        features.append({"namobj": namobj, "kelas": kelas, "geometry": geom,
                          "shpAreaHa": shp_area_ha})

    print(f"  SHP dimuat: {len(features)} fitur")
    return features


def pixel_area_ha(transform, row, crs_is_utm):
    """Luas pixel [ha] pada baris tertentu."""
    res_x = abs(transform.a)
    res_y = abs(transform.e)
    if crs_is_utm:
        return res_x * res_y / 10_000
    # WGS84: koreksi cosinus lintang
    lat = transform.f + (row + 0.5) * transform.e  # latitude tengah baris
    mp_lat = 111_132.954 - 559.822 * math.cos(2 * math.radians(lat))
    mp_lon = 111_412.84  * math.cos(math.radians(lat))
    return abs(res_x * mp_lon * res_y * mp_lat) / 10_000


def process_year(year, features):
    """Process satu tahun TIFF, return { total, byNama }."""
    tif_path = os.path.join(TIFF_DIR, f"{year}.tif")
    if not os.path.exists(tif_path):
        print(f"  [SKIP] {year}.tif tidak ditemukan")
        return None

    print(f"  Membaca {year}.tif ...", end=" ", flush=True)

    with rasterio.open(tif_path) as src:
        crs     = src.crs
        is_utm  = crs.is_projected
        nodata  = src.nodata if src.nodata is not None else 255
        data    = src.read(1)  # band 1 sebagai 2D numpy array
        profile = src.profile

        # Pre-hitung luas pixel per baris (WGS84 bervariasi per lintang)
        n_rows = data.shape[0]
        if is_utm:
            # UTM: gunakan ukuran pixel QGIS (resX × resY = 891.7533211 m²)
            px_ha_arr = np.full(n_rows, MAPBIOMASS_PIXEL_AREA_M2 / 10_000)
        else:
            px_ha_arr = np.array([
                pixel_area_ha(src.transform, r, False) for r in range(n_rows)
            ])

        total_counts = {}
        by_nama = {}
        for feat in features:
            nama  = feat["namobj"]
            kelas = feat["kelas"]
            key   = f"{nama}||{kelas}"  # compound key agar Lindung/Produksi tidak dicampur
            if key not in by_nama:
                by_nama[key] = {"namobj": nama, "kelas": kelas,
                                "shpAreaHa": 0.0, "classCounts": {}}

        # Masking per fitur dengan rasterio.mask
        # Ambil EPSG raster dari WKT (tidak perlu PROJ database lookup)
        src_epsg = src.crs.to_epsg() if is_utm else None
        for feat in features:
            nama  = feat["namobj"]
            kelas = feat["kelas"]
            geom  = feat["geometry"]
            feat_key = f"{nama}||{kelas}"  # compound key
            # Akumulasi luas polygon SHP (bisa ada beberapa polygon per compound key)
            by_nama[feat_key]["shpAreaHa"] += feat.get("shpAreaHa", 0.0)

            # Transformasikan geometry WGS84 → CRS raster jika projected
            if is_utm and src_epsg:
                geom_in_crs = transform_geojson(geom, src_epsg)
            else:
                geom_in_crs = geom

            try:
                masked_data, masked_transform = rio_mask(
                    src, [geom_in_crs], crop=True, nodata=nodata, filled=True
                )
                arr = masked_data[0]  # band 1
            except Exception:
                continue  # geometry di luar raster

            rows, cols = arr.shape
            # Hitung luas pixel per baris dalam potongan ini
            # baris pertama di masked_transform
            origin_row = int((masked_transform.f - src.transform.f) / src.transform.e)

            for r in range(rows):
                row_global = origin_row + r
                if row_global < 0 or row_global >= n_rows:
                    ha = px_ha_arr[0]
                else:
                    ha = px_ha_arr[row_global]

                row_arr = arr[r]
                # Hitung unik values di baris ini
                vals, cnts = np.unique(row_arr, return_counts=True)
                for v, c in zip(vals, cnts):
                    v = int(v)
                    if v == int(nodata) or v == 0:
                        continue
                    if v not in VALID_CODES:
                        continue
                    area = ha * c
                    cls_key = str(v)
                    by_nama[feat_key]["classCounts"][cls_key] = by_nama[feat_key]["classCounts"].get(cls_key, 0) + area
                    total_counts[cls_key] = total_counts.get(cls_key, 0) + area

    total_shp_ha = sum(e["shpAreaHa"] for e in by_nama.values())
    print(f"selesai. Classes: {sorted(int(k) for k in total_counts)} | "
          f"Luas SHP: {total_shp_ha:.2f} ha | Luas pixel: {sum(total_counts.values()):.2f} ha")
    return {"total": total_counts, "byNama": by_nama, "totalShpAreaHa": total_shp_ha}


def main():
    print(f"=== KLHK Pre-compute ===")
    print(f"SHP : {SHP_PATH}")
    print(f"TIFF: {TIFF_DIR}")
    print()

    if not os.path.exists(SHP_PATH):
        print(f"ERROR: SHP tidak ditemukan di {SHP_PATH}")
        sys.exit(1)

    features = load_shp_features(SHP_PATH)
    print()

    for year in YEARS:
        print(f"[{year}]")
        result = process_year(year, features)
        if result is None:
            continue

        out_path = os.path.join(OUTPUT_DIR, f"{year}_data.json")
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump({"year": str(year), **result}, f, separators=(",", ":"))

        size_kb = os.path.getsize(out_path) / 1024
        print(f"  Disimpan: {out_path} ({size_kb:.1f} KB)")
        print()

    print("=== Selesai ===")


if __name__ == "__main__":
    main()
