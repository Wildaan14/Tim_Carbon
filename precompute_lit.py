"""
precompute_lit.py — Pre-compute stok karbon Literature (Landsat 8) per nama hutan
==================================================================================
Jalankan sekali dari folder proyek:
    python precompute_lit.py

Input : Karbon_Literature/Stock Carbon L8 YYYY.tif  (float32, UTM 48S, 30m)
        hutan/hutan.shp
Output: public/Karbon_Literature/karbon_lit_YYYY.json

Format JSON:
  {
    "year": 2016,
    "totalCarbon": 12345.67,     # tC
    "totalAreaHa": 78940.5,      # ha
    "byNama": {
      "Hutan Halimun": {
        "namobj": "Hutan Halimun",
        "kelas":  "Hutan Konservasi",
        "carbon": 5678.9,        # tC
        "areaHa": 12345.6        # ha
      }, ...
    }
  }

Browser load JSON (< 5 KB) → tampil instan, tanpa proses TIF 17 MB.
"""

import json
import os
import sys

# ── Fix PROJ conflict ──────────────────────────────────────────
_RASTERIO_BASE = os.path.join(
    os.path.dirname(sys.executable), "Lib", "site-packages", "rasterio"
)
_PROJ_DIR = os.path.join(_RASTERIO_BASE, "proj_data")
if os.path.isdir(_PROJ_DIR):
    os.environ["PROJ_DATA"] = _PROJ_DIR
    os.environ["PROJ_LIB"]  = _PROJ_DIR
    os.environ["GDAL_DATA"] = os.path.join(_RASTERIO_BASE, "gdal_data")

try:
    import numpy as np
    import rasterio
    from rasterio.mask import mask as rio_mask
    from pyproj import Transformer
    import shapefile
except ImportError as e:
    print(f"ERROR: {e}")
    print("Install: pip install rasterio pyproj pyshp")
    sys.exit(1)

# ── KONFIGURASI ───────────────────────────────────────────────
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
SHP_PATH   = os.path.join(BASE_DIR, "hutan", "hutan.shp")
TIFF_DIR   = os.path.join(BASE_DIR, "Karbon_Literature")
OUT_DIR    = os.path.join(BASE_DIR, "public", "Karbon_Literature")
YEARS      = list(range(2015, 2026))   # 2015-2025
NODATA_THR = -1e10                     # float32 nodata dari GEE (~-3.4e38)

# ── REFERENSI STATISTIK QGIS (override untuk TIF yang salah/copy) ─
# Sumber: QGIS Raster Statistics per tahun (sum, m2 dari tabel)
# pixel_ha = 0.09 → totalCarbon = sum × 0.09; totalAreaHa = m2 / 10000
QGIS_STATS = {
    # 2017.tif adalah copy dari 2018.tif — gunakan statistik QGIS yang benar
    2017: {"sum": 968342.9237, "m2": 835559100},
}


# ── LOAD SHP ──────────────────────────────────────────────────
def load_shp_features(shp_path):
    sf = shapefile.Reader(shp_path, encoding="latin-1")
    fields = [f[0].lower() for f in sf.fields[1:]]
    features = []
    for rec in sf.shapeRecords():
        props = {fields[i]: rec.record[i] for i in range(len(fields))}
        namobj = (props.get("namobj") or props.get("NAMOBJ") or "Hutan").strip()
        kelas  = (props.get("kelas")  or props.get("KELAS")  or "–").strip()
        geom   = rec.shape.__geo_interface__
        features.append({"namobj": namobj, "kelas": kelas, "geometry": geom})
    print(f"  SHP: {len(features)} fitur dimuat")
    return features


# ── AREA GEOMETRIK SHP (Shoelace, UTM) ────────────────────────
def compute_shp_area_ha(geom_wgs84, dst_epsg):
    """
    Hitung luas polygon SHP dalam ha menggunakan Shoelace formula
    pada koordinat UTM — hasilnya konsisten di semua tahun.
    """
    trans = Transformer.from_crs(4326, dst_epsg, always_xy=True)

    def _ring_area_m2(coords):
        utm = [trans.transform(lon, lat) for lon, lat in coords]
        n   = len(utm)
        area = 0.0
        for i in range(n):
            j = (i + 1) % n
            area += utm[i][0] * utm[j][1]
            area -= utm[j][0] * utm[i][1]
        return abs(area) / 2.0

    gtype  = geom_wgs84.get("type", "")
    coords = geom_wgs84.get("coordinates", [])
    total_m2 = 0.0

    if gtype == "Polygon":
        total_m2 = _ring_area_m2(coords[0])          # ring luar
        for hole in coords[1:]:                        # lubang
            total_m2 -= _ring_area_m2(hole)
    elif gtype == "MultiPolygon":
        for poly in coords:
            total_m2 += _ring_area_m2(poly[0])
            for hole in poly[1:]:
                total_m2 -= _ring_area_m2(hole)

    return max(0.0, total_m2 / 10_000.0)              # m² → ha


# ── GEOJSON GEOMETRY → list rings dalam CRS tujuan ────────────
def get_rings_epsg(geom, dst_epsg):
    """Return list of rings (UTM coords) dari GeoJSON geometry."""
    trans = Transformer.from_crs(4326, dst_epsg, always_xy=True)

    def _ring(coords):
        return [trans.transform(lon, lat) for lon, lat in coords]

    gtype = geom.get("type", "")
    coords = geom.get("coordinates", [])
    if gtype == "Polygon":
        return [_ring(r) for r in coords]
    elif gtype == "MultiPolygon":
        rings = []
        for poly in coords:
            rings.extend([_ring(r) for r in poly])
        return rings
    return []


# ── STATISTIK TOTAL DARI FULL RASTER (tanpa kliping SHP) ───────
def compute_raster_totals(tif_path):
    """
    Hitung total statistik dari seluruh raster (sama persis dengan QGIS).
    Tidak perlu kliping SHP — raster sudah berisi nodata di luar area studi.
    """
    with rasterio.open(tif_path) as src:
        data     = src.read(1).astype(np.float64)
        nodata   = src.nodata
        pixel_ha = abs(src.res[0] * src.res[1]) / 10_000.0

        mask = np.isnan(data) == False
        if nodata is not None:
            mask = mask & (data != nodata)
        mask = mask & (data > NODATA_THR)

        valid        = data[mask]
        total_carbon = float(valid.sum()) * pixel_ha
        total_area   = float(len(valid)) * pixel_ha
    return total_carbon, total_area


# ── SAMPLE TIFF PER FEATURE ────────────────────────────────────
def sample_tiff_per_feature(tif_path, features, crs_epsg):
    """
    Mask raster ke setiap fitur hutan, kemudian:
      - sum nilai valid (tC/ha × pixel_area_ha) → carbon [tC]
      - count pixel valid × pixel_area_ha → areaHa [ha]
    """
    results = {}
    total_carbon = 0.0
    total_area   = 0.0

    with rasterio.open(tif_path) as src:
        pixel_res = abs(src.res[0] * src.res[1])  # m²
        pixel_ha  = pixel_res / 10_000.0           # ha
        nodata    = src.nodata

        for feat in features:
            namobj = feat["namobj"]
            kelas  = feat["kelas"]

            # Build shapely-compatible geometry dict dalam CRS raster
            # rasterio.mask pakai WGS84 jika src.crs berbeda — transform dulu
            geom_native = _to_rasterio_geom(feat["geometry"], src.crs.to_epsg())

            try:
                masked, _ = rio_mask(src, [geom_native], crop=True, filled=True,
                                     nodata=nodata if nodata is not None else NODATA_THR)
                data = masked[0].astype(np.float64)
            except Exception:
                results[namobj] = {"namobj": namobj, "kelas": kelas, "carbon": 0.0, "areaHa": 0.0}
                continue

            # Mask nodata — pakai semua pixel valid (termasuk negatif),
            # sesuai perhitungan statistik QGIS (Zonal Statistics)
            if nodata is not None:
                valid_mask = (data != nodata) & (~np.isnan(data)) & (data > NODATA_THR)
            else:
                valid_mask = (~np.isnan(data)) & (data > NODATA_THR)

            valid_vals = data[valid_mask]
            # Gunakan pixel count × pixel_ha untuk area (konsisten dengan QGIS m2/10000)
            feat_area   = float(len(valid_vals)) * pixel_ha
            feat_carbon = float(np.sum(valid_vals) * pixel_ha)  # Σ (tC/ha × ha) = tC

            # Akumulasi per nama hutan
            if namobj in results:
                results[namobj]["carbon"] += feat_carbon
                results[namobj]["areaHa"] += feat_area
            else:
                results[namobj] = {
                    "namobj": namobj,
                    "kelas":  kelas,
                    "carbon": feat_carbon,
                    "areaHa": feat_area,
                }

            total_carbon += feat_carbon

    # total_area = jumlah area geometrik semua nama unik (sudah terakumulasi)
    total_area = sum(v["areaHa"] for v in results.values())
    return results, total_carbon, total_area


def _to_rasterio_geom(geom_wgs84, raster_epsg):
    """
    Jika raster dalam UTM, transform geometry ke UTM.
    Jika WGS84, kembalikan apa adanya.
    rasterio.mask menerima GeoJSON geometry dict dalam CRS raster.
    """
    if raster_epsg == 4326:
        return geom_wgs84  # sudah WGS84

    trans = Transformer.from_crs(4326, raster_epsg, always_xy=True)

    def _ring(coords):
        return [list(trans.transform(lon, lat)) for lon, lat in coords]

    gtype = geom_wgs84.get("type", "")
    c     = geom_wgs84.get("coordinates", [])
    if gtype == "Polygon":
        return {"type": "Polygon", "coordinates": [_ring(r) for r in c]}
    elif gtype == "MultiPolygon":
        return {"type": "MultiPolygon",
                "coordinates": [[_ring(r) for r in poly] for poly in c]}
    return geom_wgs84


# ── MAIN ───────────────────────────────────────────────────────
def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    print(f"[1/2] Memuat SHP: {SHP_PATH}")
    features = load_shp_features(SHP_PATH)

    with rasterio.open(os.path.join(TIFF_DIR, f"Stock Carbon L8 2016.tif")) as probe:
        crs_epsg = probe.crs.to_epsg()
    print(f"  CRS raster : EPSG:{crs_epsg}")

    # Precompute area geometrik SHP per fitur (sama untuk semua tahun)
    print("  Menghitung area geometrik per fitur SHP...")
    for feat in features:
        feat["shpAreaHa"] = compute_shp_area_ha(feat["geometry"], crs_epsg)
    total_shp_area = sum(f["shpAreaHa"] for f in features)
    print(f"  Total area SHP (geometrik): {total_shp_area:,.0f} ha")

    created = 0
    for year in YEARS:
        tif_path = os.path.join(TIFF_DIR, f"Stock Carbon L8 {year}.tif")
        out_path = os.path.join(OUT_DIR, f"karbon_lit_{year}.json")

        if not os.path.exists(tif_path):
            print(f"  [{year}] TIF tidak ditemukan — skip")
            continue

        print(f"\n[2/2] Proses tahun {year} ...", end="", flush=True)
        # Total dari full raster (sama dengan QGIS Raster Statistics)
        total_carbon, total_area = compute_raster_totals(tif_path)
        # Per-hutan breakdown dari kliping per-polygon
        by_nama, computed_total, _ = sample_tiff_per_feature(tif_path, features, crs_epsg)

        # Override total jika TIF yang digunakan bukan data tahun yang benar (misalnya copy)
        if year in QGIS_STATS:
            qg = QGIS_STATS[year]
            pixel_ha_ref = qg["m2"] / qg.get("count", qg["m2"] / 900) / 10_000.0 if "count" not in qg else qg["m2"] / qg["count"] / 10_000.0
            total_carbon  = round(qg["sum"] * 0.09, 4)   # pixel_ha = 900 m² = 0.09 ha
            total_area    = round(qg["m2"] / 10_000.0, 4)
            # Skala byNama secara proporsional dari total yang dihitung
            scale = total_carbon / computed_total if computed_total > 0 else 1.0
            for v in by_nama.values():
                v["carbon"] = round(v["carbon"] * scale, 4)
            print(f"  [QGIS override] total={total_carbon:,.0f} tC  scale={scale:.4f}", end="")

        result = {
            "year":        year,
            "totalCarbon": round(total_carbon, 4),
            "totalAreaHa": round(total_area,   4),
            "byNama":      {
                k: {
                    "namobj": v["namobj"],
                    "kelas":  v["kelas"],
                    "carbon": round(v["carbon"], 4),
                    "areaHa": round(v["areaHa"], 4),
                }
                for k, v in by_nama.items()
            },
        }

        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        size_kb = os.path.getsize(out_path) / 1024
        print(f"  >> {out_path}  ({size_kb:.1f} KB)  total: {total_carbon:,.0f} tC  area: {total_area:,.0f} ha")
        created += 1

    print(f"\n=== SELESAI — {created} file JSON dibuat di public/Karbon_Literature/ ===")
    print("Reload browser untuk menggunakan data pre-computed (muat instan).")


if __name__ == "__main__":
    main()
