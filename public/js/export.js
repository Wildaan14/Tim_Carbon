// ============================================================
// export.js — Generator laporan teks (.txt)
// ============================================================

function exportReport(data) {
  if (!data) return;
  const { areaHa, stock, method, classData, year } = data;
  const lbl = _lang === "id";
  const now = new Date().toLocaleDateString("id-ID", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const methodLabel = {
    ipcc: "IPCC 2019 Wetlands Supplement",
    nfi: "KLHK (National Forest Inventory)",
    lefebvre: "Literature (Mangrove-specific)",
  }[method || "ipcc"];

  const SEP = "=".repeat(60);
  const SEP2 = "-".repeat(44);

  const lines = [
    SEP,
    "        CARBON GIS — " +
      (lbl ? "LAPORAN STOK KARBON" : "CARBON STOCK REPORT"),
    SEP,
    (lbl ? "Tanggal    " : "Date       ") + ": " + now,
    (lbl ? "Tahun Data " : "Data Year  ") +
      ": " +
      (year || new Date().getFullYear()),
    "Metodologi : " + methodLabel,
    SEP2,
    "",
    "[ " + (lbl ? "INFORMASI AREA" : "AREA INFORMATION") + " ]",
    "  " +
      (lbl ? "Total Area" : "Total Area") +
      " : " +
      (areaHa || 0).toFixed(2) +
      " ha",
    "",
    "[ " + (lbl ? "STOK KARBON TOTAL (tC)" : "TOTAL CARBON STOCK (tC)") + " ]",
    "  Aboveground Biomass (AGB) : " + fmt(stock.aboveground) + " tC",
    "  Belowground Biomass (BGB) : " + fmt(stock.belowground) + " tC",
    SEP2,
    "  TOTAL                     : " + fmt(stock.total) + " tC",
    "",
    "[ " + (lbl ? "EKUIVALEN CO₂" : "CO₂ EQUIVALENT") + " ]",
    "  " + fmt(stock.co2Equivalent) + " tCO₂eq  (faktor: 3.67)",
    "",
  ];

  if (classData && Object.keys(classData).length) {
    lines.push(
      "[ " + (lbl ? "DETAIL PER KELAS TUTUPAN" : "PER LAND COVER CLASS") + " ]",
    );
    lines.push(
      "  " +
        "Kode".padEnd(6) +
        "Kelas".padEnd(28) +
        "Area (ha)".padEnd(14) +
        "AGB Total (Mg)".padEnd(16) +
        "Total (tC)",
    );
    lines.push("  " + "-".repeat(72));
    Object.entries(classData).forEach(([code, d]) => {
      if (!d.areaHa) return;
      lines.push(
        "  " +
          String(code).padEnd(6) +
          (d.nameId || d.name || "").substring(0, 26).padEnd(28) +
          fmtDec(d.areaHa).padEnd(14) +
          fmt(d.biomass_total ?? 0).padEnd(16) +
          fmt(d.carbon),
      );
    });
    lines.push("");
  }

  lines.push(SEP);
  lines.push("  CarbonGIS — " + methodLabel);
  lines.push(SEP);

  const blob = new Blob([lines.join("\n")], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "carbongis-report-" + Date.now() + ".txt";
  a.click();
  URL.revokeObjectURL(url);
}
