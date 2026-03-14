# Conservation & Restoration Classification Implementation Plan

## Overview

Implement logic to classify forest areas based on carbon stock trends (2015-2024) using linear regression and composite scoring.

## Steps

### Step 1: Add Classification Logic to js/data.js

- [x] Add regression analysis functions (slope, R² calculation)
- [x] Add composite scoring logic
- [x] Add classification categories constants

### Step 2: Add Classification State to js/app.js

- [x] Add state variables for classification results
- [x] Add classification computation function

### Step 3: Update Konservasi Tab UI in index.html

- [x] Add classification legend with 4 categories
- [x] Add stats panel for classification results
- [x] Add classification toggle/filter controls

### Step 4: Implement Map Visualization

- [x] Color-code forest polygons by classification category
- [x] Add popup showing classification details

### Step 5: Add to Statistik Tab (Optional)

- [ ] Add classification summary in tren tahunan view - SKIPPED

## Classification Categories

1. **Konservasi Prioritas Tinggi** - Positive slope + stock above average (#0d9488 teal)
2. **Konservasi dengan Pemantauan** - High stock but flat/negative slope (#52b788 green)
3. **Restorasi Aktif** - Negative slope OR stock far below average (#e07a5f coral)
4. **Waspada/Transisi** - Positive slope but stock still below average (#f2cc8f yellow)

## Technical Details

- Linear regression: year (2015-2024) vs carbon stock
- Score = β₁ (slope) × 0.5 + R² × 0.3 + relative_position × 0.2
- Output: JSON with slope, R², score, category for each forest name
