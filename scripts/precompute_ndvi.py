import os
import json
import numpy as np
import rasterio
from rasterio.mask import mask
import geopandas as gpd
from shapely.geometry import mapping

def ndvi_to_carbon_density(ndvi_arr):
    """carbon = max(0, (678.67 * ndvi - 148.07) * 0.09) if ndvi >= 0.218"""
    # Filter based on the threshold mentioned in previous logic
    valid_threshold = 0.218
    mask_valid = ndvi_arr >= valid_threshold
    
    carbon = np.zeros_like(ndvi_arr, dtype=np.float64)
    # Apply formula only to values >= threshold
    carbon[mask_valid] = (678.67 * ndvi_arr[mask_valid] - 148.07) * 0.09
    return np.maximum(0, carbon)

def process_year(year, geojson_path, tiff_path, output_path):
    print(f"\n{'='*60}")
    print(f"Processing year {year}...")
    print(f"  TIFF: {tiff_path}")
    
    # Load the GeoJSON boundary
    gdf = gpd.read_file(geojson_path)
    # Dissolve to a single geometry for global calculation as requested
    unified_geom = [mapping(gdf.unary_union)]
    
    with rasterio.open(tiff_path) as src:
        tiff_crs = src.crs
        
        # Reproject if necessary
        if gdf.crs != tiff_crs:
            gdf = gdf.to_crs(tiff_crs)
            unified_geom = [mapping(gdf.unary_union)]
        
        transform = src.transform
        res_x = abs(transform[0])
        res_y = abs(transform[4])
        
        # Pixel area in hectares
        if src.crs.is_geographic:
            center_lat = (src.bounds.bottom + src.bounds.top) / 2
            mp_lat = 111132.954 - 559.822 * np.cos(np.radians(2 * center_lat))
            mp_lon = 111412.84 * np.cos(np.radians(center_lat))
            pixel_area_ha = (res_x * mp_lon * res_y * mp_lat) / 10000.0
        else:
            pixel_area_ha = (res_x * res_y) / 10000.0
        
        try:
            # Mask the raster with the unified geometry
            out_image, out_transform = mask(src, unified_geom, crop=True, nodata=0)
            band = out_image[0].astype(np.float64)
            
            # Handle scaled NDVI (e.g. Landsat values often scaled by 10000)
            if np.nanmax(np.abs(band[band != 0])) > 1.5:
                band = band / 10000.0
            
            # Valid mask: within valid NDVI range
            valid_mask = (band != 0) & (band >= -1) & (band <= 1)
            valid_data = band[valid_mask]
            
            if len(valid_data) == 0:
                print(f"  No valid data for year {year}")
                return

            # Carbon density calculation
            carbon_densities = ndvi_to_carbon_density(valid_data)
            # Total carbon = density * area per pixel
            carbon_per_pixel = carbon_densities * pixel_area_ha
            
            total_carbon = float(np.sum(carbon_per_pixel))
            total_area_ha = float(len(valid_data) * pixel_area_ha)
            
            # Classification
            # High: NDVI >= 0.65
            # Medium: 0.50 <= NDVI < 0.65
            # Low: 0.218 <= NDVI < 0.50
            high_mask = valid_data >= 0.65
            med_mask = (valid_data >= 0.50) & (valid_data < 0.65)
            low_mask = (valid_data >= 0.218) & (valid_data < 0.50)
            
            class_counts = {
                "lit_high": float(np.sum(high_mask) * pixel_area_ha),
                "lit_medium": float(np.sum(med_mask) * pixel_area_ha),
                "lit_low": float(np.sum(low_mask) * pixel_area_ha)
            }
            
            class_carbons = {
                "lit_high": float(np.sum(carbon_per_pixel[high_mask])),
                "lit_medium": float(np.sum(carbon_per_pixel[med_mask])),
                "lit_low": float(np.sum(carbon_per_pixel[low_mask]))
            }
            
            result = {
                "year": int(year),
                "method": "literature",
                "totalCarbon": round(total_carbon, 4),
                "totalAreaHa": round(total_area_ha, 4),
                "classCounts": {k: round(v, 4) for k, v in class_counts.items()},
                "classCarbons": {k: round(v, 4) for k, v in class_carbons.items()},
                "byNama": {} # Empty as requested: "per nama hutan itu gausah"
            }
            
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
            
            print(f"  => Total Carbon: {total_carbon:.2f} tC")
            print(f"  => Total Area:   {total_area_ha:.2f} ha")
            print(f"  => Saved to:     {output_path}")

        except Exception as e:
            print(f"  Error processing {year}: {e}")

if __name__ == "__main__":
    # Settings per user request
    geojson_source = "public/NDVI_Landsat8/NDVI_Pangawari.geojson"
    output_dir = "public/NDVI_Landsat8" # Same folder as requested
    
    os.makedirs(output_dir, exist_ok=True)
    
    for year in range(2015, 2025):
        tiff_input = f"public/NDVI_Landsat8/NDVI_{year}.tif"
        if os.path.exists(tiff_input):
            output_json = os.path.join(output_dir, f"karbon_lit_{year}.json")
            process_year(year, geojson_source, tiff_input, output_json)
        else:
            print(f"Warning: {tiff_input} not found, skipping.")
    
    print(f"\n{'='*60}")
    print("Pre-computation finished using simplified NDVI method.")
