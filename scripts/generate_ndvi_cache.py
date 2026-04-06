import os
import json
import numpy as np
import rasterio
from rasterio.features import shapes
from rasterio.mask import mask
import geopandas as gpd
from shapely.geometry import shape

def process_ndvi_file(input_tiff, output_geojson, output_json, year, h_gdf=None):
    with rasterio.open(input_tiff) as src:
        band = src.read(1).astype(np.float64)
        transform = src.transform
        nodata = src.nodata
        crs = src.crs

        # Scale if necessary (L8 usually -1 to 1)
        if np.nanmax(np.abs(band[band != nodata])) > 1.5:
            band = band / 10000.0

        valid_mask = (band != nodata) & (band >= -1) & (band <= 1)
        if not np.any(valid_mask):
            print(f"Skipping {year}, no valid data.")
            return

        # Area calculation (Hectares)
        res_x = abs(transform[0])
        res_y = abs(transform[4])
        if crs.is_geographic:
            center_lat = (src.bounds.bottom + src.bounds.top) / 2
            mp_lat = 111132.954 - 559.822 * np.cos(np.radians(2 * center_lat))
            mp_lon = 111412.84 * np.cos(np.radians(center_lat))
            pixel_area_ha = (res_x * mp_lon * res_y * mp_lat) / 10000.0
        else:
            pixel_area_ha = (res_x * res_y) / 10000.0

        threshold = 0.2181767280121414
        
        # [Formula Correction] Removed the redundant * 0.09 multiplier
        # The 0.09 in the user's prompt was likely the pixel area itself.
        carbon_density = np.zeros_like(band, dtype=np.float64)
        calc_mask = valid_mask & (band >= threshold)
        
        # Base formula: 678.67 * NDVI - 148.07
        carbon_density[calc_mask] = (678.67 * band[calc_mask] - 148.07)
        carbon_density[calc_mask] = np.maximum(0, carbon_density[calc_mask])

        # Global Stats (Scene-wide where NDVI > threshold)
        total_carbon = float(np.sum(carbon_density[calc_mask] * pixel_area_ha))
        total_area_ha = float(np.sum(calc_mask)) * pixel_area_ha
        avg_ndvi = float(np.mean(band[calc_mask])) if np.any(calc_mask) else 0.0

        print(f"[{year}] Global: {total_carbon:.2f} tC over {total_area_ha:.2f} ha. Avg NDVI: {avg_ndvi:.4f}")

        # Zonal Stats (Per Forest if SHP provided)
        by_nama = {}
        if h_gdf is not None:
            print(f"[{year}] Calculating zonal statistics for {len(h_gdf)} polygons...")
            # Ensure CRS matches
            h_gdf_proj = h_gdf.to_crs(crs)
            for _, row in h_gdf_proj.iterrows():
                try:
                    # Clip raster by forest geometry
                    out_image, out_transform = mask(src, [row.geometry], crop=True)
                    f_band = out_image[0].astype(np.float64)
                    if np.nanmax(np.abs(f_band)) > 1.5: f_band /= 10000.0
                    
                    f_mask = (f_band != nodata) & (f_band >= threshold)
                    if np.any(f_mask):
                        f_carbon = np.sum((678.67 * f_band[f_mask] - 148.07) * pixel_area_ha)
                        f_area = np.sum(f_mask) * pixel_area_ha
                        
                        nama = row.get('NAMOBJ') or row.get('namobj') or 'Unknown'
                        kelas = row.get('KELAS') or row.get('kelas') or '-'
                        
                        if nama not in by_nama:
                            by_nama[nama] = {"namobj": nama, "kelas": kelas, "carbon": 0, "areaHa": 0}
                        
                        by_nama[nama]["carbon"] += float(f_carbon)
                        by_nama[nama]["areaHa"] += float(f_area)
                except Exception as e:
                    continue

        # Vectorization for Map (Simulated 3 modes using properties)
        print(f"[{year}] Vectorizing for map layers...")
        bins = [-1, threshold, 0.4, 0.6, 1.0]
        classified = np.digitize(band, bins).astype(np.int16)
        classified[~valid_mask] = 0
        classified[classified == 1] = 0

        poly_shapes = shapes(classified, mask=(classified > 0), transform=transform)
        
        features = []
        for geom, val in poly_shapes:
            cid = int(val)
            # Assign properties for different modes
            # Mode NDVI (cid val), Carbon (derived), Forest (if we were in browser)
            # In GeoJSON we just store the classification and density context
            c_val = (678.67 * (bins[cid-1] if cid > 1 else 0) - 148.07) # rough proxy for legend
            
            features.append({
                'type': 'Feature',
                'properties': {
                    'class_id': cid,
                    'ndvi_val': float(bins[cid-1] if cid > 1 else 0),
                    'carbon_density': float(np.maximum(0, c_val))
                },
                'geometry': shape(geom)
            })
            
        gdf = gpd.GeoDataFrame.from_features(features, crs=crs)
        if gdf.crs != 'epsg:4326':
            gdf = gdf.to_crs('epsg:4326')

        with open(output_geojson, 'w', encoding='utf-8') as f:
            f.write(gdf.to_json(to_wgs84=True, drop_id=True))
            
        # Stats payload
        stats = {
            "year": int(year),
            "totalCarbon": round(total_carbon, 4),
            "totalAreaHa": round(total_area_ha, 4),
            "avgNdvi": round(avg_ndvi, 4),
            "byNama": by_nama
        }
        with open(output_json, 'w', encoding='utf-8') as f:
            json.dump(stats, f, indent=2)

if __name__ == "__main__":
    import glob
    input_dir = "public/NDVI_Landsat8"
    tiffs = sorted(glob.glob(os.path.join(input_dir, "NDVI_*.tif")))
    
    # Pre-load forest SHP
    h_gdf = None
    try:
        h_gdf = gpd.read_file("hutan/hutan.zip")
    except:
        print("Warning: hutan.zip not found or corrupt. Per-forest stats will be skipped.")

    for tiff in tiffs:
        y_str = os.path.basename(tiff).replace("NDVI_", "").replace(".tif", "")
        out_geo = os.path.join(input_dir, f"ndvi_{y_str}.geojson")
        out_js = os.path.join(input_dir, f"karbon_ndvi_{y_str}.json")
        process_ndvi_file(tiff, out_geo, out_js, y_str, h_gdf)
