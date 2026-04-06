import json, geopandas as gpd

# 1. Cek nama hutan di SHP
gdf = gpd.read_file("public/hutan/hutan.shp")
shp_names = sorted(gdf['namobj'].unique())
print(f"=== hutan.shp: {len(gdf)} rows, {len(shp_names)} unique forests ===")
for n in shp_names:
    print(f"  - {n}")

# 2. Cek nama hutan di JSON 2024
with open("public/Karbon_Literature/karbon_lit_2024.json") as f:
    d = json.load(f)
json_names = sorted(d['byNama'].keys())
print(f"\n=== JSON 2024: {len(json_names)} forests ===")
for n in json_names:
    print(f"  - {n}")

# 3. Cross-check: apakah semua nama SHP ada di JSON?
missing = set(shp_names) - set(json_names)
extra = set(json_names) - set(shp_names)
print(f"\n=== Cross-check ===")
print(f"SHP names missing from JSON: {missing if missing else 'NONE - All match!'}")
print(f"JSON names not in SHP: {extra if extra else 'NONE - All match!'}")

# 4. Cek apakah ada file JSON yang stale (karbon_lit_2025.json)
import os
all_json = [f for f in os.listdir("public/Karbon_Literature") if f.startswith("karbon_lit")]
print(f"\n=== All JSON files in Karbon_Literature ===")
for f in sorted(all_json):
    print(f"  {f}")
