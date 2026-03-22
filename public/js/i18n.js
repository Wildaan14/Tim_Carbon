// ============================================================
// i18n.js — Terjemahan Bahasa Indonesia / English
// ============================================================

const TEXTS = {
  id: {
    tagline: "CARBON STOCK CALCULATOR · IPCC 2019 · KLHK · LITERATURE",
    secUpload: "Upload Raster",
    secTools: "Alat",
    secMethod: "Metodologi",
    secYear: "Tahun",
    tabCarbon: "Carbon",
    tabKonservasi: "Konservasi",
    tabStatistik: "Statistik",
    toolDraw: "Gambar Polygon",
    toolReset: "Reset",
    dropHint: "<strong>Klik atau drag</strong> file GeoTIFF<br>(.tif / .tiff)",
    btnCalc: "🌿 Hitung Stok Karbon",
    btnCalcing: "Menghitung...",
    btnExport: "📄 Ekspor Laporan (.txt)",
    resTitle: "Hasil Stok Karbon",
    resTotal: "Total Stok Karbon",
    resEquiv: "Ekuivalen",
    resBreakdown: "Breakdown Biomassa",
    resAbove: "AGB",
    resBelow: "BGB",
    resDead: "DW",
    resLitter: "LT",
    resSoil: "SOC",
    resSource: "📖 Sumber: IPCC 2019 Wetlands Supplement",
    lblLegend: "🗺 Legenda Tutupan Lahan",
    areaLabel: "Area",
    drawHint:
      "✏️ Klik peta untuk menggambar polygon. Klik ganda untuk selesai.",
    errTif: "⚠ Upload file GeoTIFF (.tif / .tiff) terlebih dahulu.",
    errNoArea: "⚠ Gambar atau upload GeoTIFF terlebih dahulu.",
    errParse: "⚠ Gagal membaca file. Pastikan format GeoTIFF valid.",
    lblClassTitle: "Per Kelas Tutupan",
  },
  en: {
    tagline: "CARBON STOCK CALCULATOR · IPCC 2019 · KLHK · LITERATURE",
    secUpload: "Upload Raster",
    secTools: "Tools",
    secMethod: "Methodology",
    secYear: "Year",
    tabCarbon: "Carbon",
    tabKonservasi: "Conservation",
    tabStatistik: "Statistics",
    toolDraw: "Draw Polygon",
    toolReset: "Reset",
    dropHint:
      "<strong>Click or drag</strong> GeoTIFF file here<br>(.tif / .tiff)",
    btnCalc: "🌿 Calculate Carbon Stock",
    btnCalcing: "Calculating...",
    btnExport: "📄 Export Report (.txt)",
    resTitle: "Carbon Stock Result",
    resTotal: "Total Carbon Stock",
    resEquiv: "Equivalent",
    resBreakdown: "Biomass Breakdown",
    resAbove: "AGB",
    resBelow: "BGB",
    resDead: "DW",
    resLitter: "LT",
    resSoil: "SOC",
    resSource: "📖 Source: IPCC 2019 Wetlands Supplement",
    lblLegend: "🗺 Land Cover Legend",
    areaLabel: "Area",
    drawHint: "✏️ Click the map to draw a polygon. Double-click to finish.",
    errTif: "⚠ Please upload a GeoTIFF file (.tif / .tiff) first.",
    errNoArea: "⚠ Please draw a polygon or upload a GeoTIFF first.",
    errParse: "⚠ Failed to read file. Ensure the GeoTIFF is valid.",
    lblClassTitle: "Per Land Cover Class",
  },
};

let _lang = "id";

function setLang(l) {
  _lang = l;
}
function t(k) {
  return TEXTS[_lang]?.[k] ?? k;
}
