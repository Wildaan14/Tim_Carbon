// ============================================================
// charts.js — Chart rendering (Chart.js)
// ============================================================

let _chartCarbon = null;
let _chartKomparasi = null;
let _chartDonut = null;

// ── CARBON BAR CHART ────────────────────────────────────────
function renderCarbonChart(classData) {
  // classData: { code: { name, areaHa, agb, bgb, carbon, co2 }, ... }
  const canvas = document.getElementById("chart-carbon");
  const empty = document.getElementById("chart-empty-carbon");
  if (!canvas) return;

  const entries = Object.entries(classData).filter(([, d]) => d.carbon > 0);
  if (!entries.length) {
    empty && (empty.style.display = "flex");
    return;
  }
  if (empty) empty.style.display = "none";

  const labels = entries.map(([, d]) => d.nameId || d.name);
  const agb = entries.map(([, d]) => +d.agb_total.toFixed(2));
  const bgb = entries.map(([, d]) => +d.bgb_total.toFixed(2));
  const colors = entries.map(
    ([code]) =>
      LANDCOVER_CLASS_VALUES[code]?.color ??
      IPCC_FOREST_TYPES[code]?.color ??
      NDVI_CARBON_CLASSES[code]?.color ??
      "#52b788",
  );

  if (_chartCarbon) _chartCarbon.destroy();

  _chartCarbon = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "AGB (tC)",
          data: agb,
          backgroundColor: colors.map((c) => c + "cc"),
          borderColor: colors,
          borderWidth: 1.5,
          borderRadius: 4,
        },
        {
          label: "BGB (tC)",
          data: bgb,
          backgroundColor: colors.map((c) => hexAlpha(c, 0.55)),
          borderColor: colors.map((c) => hexAlpha(c, 0.8)),
          borderWidth: 1.5,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: "#4a7869", font: { size: 11 } },
          position: "top",
        },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString("id-ID")} tC`,
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: { color: "#4a7869", font: { size: 10 } },
          grid: { color: "rgba(0,0,0,0.07)" },
        },
        y: {
          stacked: true,
          ticks: {
            color: "#4a7869",
            font: { size: 10 },
            callback: (v) => v.toLocaleString("id-ID") + " tC",
          },
          grid: { color: "rgba(0,0,0,0.07)" },
          title: {
            display: true,
            text: "Carbon Stock (tC)",
            color: "#4a7869",
            font: { size: 11 },
          },
        },
      },
    },
  });
}

// ── KOMPARASI SCATTER CHART ──────────────────────────────────
function renderKomparasiChart(classData) {
  const canvas = document.getElementById("chart-komparasi");
  const empty = document.getElementById("chart-empty-komparasi");
  if (!canvas) return;

  const entries = Object.entries(classData).filter(([, d]) => d.agb_total > 0);
  if (!entries.length) {
    empty && (empty.style.display = "flex");
    return;
  }
  if (empty) empty.style.display = "none";

  const datasets = entries.map(([code, d]) => ({
    label: d.nameId || d.name,
    data: [{ x: +d.agb_total.toFixed(2), y: +d.bgb_total.toFixed(2) }],
    pointBackgroundColor:
      LANDCOVER_CLASS_VALUES[code]?.color ??
      IPCC_FOREST_TYPES[code]?.color ??
      NDVI_CARBON_CLASSES[code]?.color ??
      "#52b788",
    pointBorderColor: "#fff",
    pointRadius: Math.max(6, Math.min(20, Math.sqrt(d.areaHa) * 0.4)),
    pointHoverRadius: 14,
  }));

  if (_chartKomparasi) _chartKomparasi.destroy();

  _chartKomparasi = new Chart(canvas, {
    type: "scatter",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: "#4a7869", font: { size: 11 } },
          position: "right",
        },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label} — AGB: ${ctx.parsed.x.toLocaleString("id-ID")} | BGB: ${ctx.parsed.y.toLocaleString("id-ID")} tC`,
          },
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "AGB (tC)",
            color: "#4a7869",
            font: { size: 11 },
          },
          ticks: { color: "#4a7869" },
          grid: { color: "rgba(0,0,0,0.07)" },
        },
        y: {
          title: {
            display: true,
            text: "BGB (tC)",
            color: "#4a7869",
            font: { size: 11 },
          },
          ticks: { color: "#4a7869" },
          grid: { color: "rgba(0,0,0,0.07)" },
        },
      },
    },
  });
}

// ── STATS TABLE ──────────────────────────────────────────────
function renderStatsTable(classData) {
  const tbody = document.getElementById("stats-tbody");
  if (!tbody) return;
  const entries = Object.entries(classData);
  if (!entries.length) return;

  tbody.innerHTML = "";
  let totalArea = 0,
    totalBiomass = 0,
    totalC = 0,
    totalCo2 = 0;

  entries.forEach(([code, d]) => {
    const cl =
      LANDCOVER_CLASS_VALUES[code] ??
      IPCC_FOREST_TYPES[code] ??
      NDVI_CARBON_CLASSES[code];
    const color = cl?.color ?? "#999";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="td-code">${code}</td>
      <td><span class="tbl-dot" style="background:${color}"></span>${d.nameId || d.name}</td>
      <td>${fmtDec(d.areaHa)} ha</td>
      <td>${fmtDec(d.biomass_total ?? 0)}</td>
      <td class="td-carbon">${fmt(d.carbon)}</td>
      <td class="td-co2">${fmt(d.co2)}</td>
    `;
    tbody.appendChild(tr);
    totalArea += d.areaHa || 0;
    totalBiomass += d.biomass_total || 0;
    totalC += d.carbon || 0;
    totalCo2 += d.co2 || 0;
  });

  // Total row
  const trTot = document.createElement("tr");
  trTot.style.cssText = "font-weight:700; background:rgba(82,183,136,0.07)";
  trTot.innerHTML = `
    <td colspan="2" style="color:var(--accent)">TOTAL</td>
    <td>${fmtDec(totalArea)} ha</td>
    <td>${fmt(totalBiomass)}</td>
    <td class="td-carbon">${fmt(totalC)}</td>
    <td class="td-co2">${fmt(totalCo2)}</td>
  `;
  tbody.appendChild(trTot);
}

// ── UPDATE SUMMARY ───────────────────────────────────────────
function updateStatsSummary(
  totalArea,
  totalCarbon,
  totalCo2,
  dominantClass,
  method,
) {
  const s = (id) => document.getElementById(id);
  if (s("ss-area")) s("ss-area").textContent = fmtDec(totalArea) + " ha";
  if (s("ss-carbon")) s("ss-carbon").textContent = fmt(totalCarbon) + " tC";
  if (s("ss-co2")) s("ss-co2").textContent = fmt(totalCo2) + " tCO₂eq";
  if (s("ss-dominant")) s("ss-dominant").textContent = dominantClass || "–";
  if (s("ss-method")) s("ss-method").textContent = method || "IPCC 2019";
}

// ── EXPORT CHART ─────────────────────────────────────────────
function exportChart() {
  const canvas = document.getElementById("chart-carbon");
  if (!canvas || !_chartCarbon) return;
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = "carbon-chart-" + Date.now() + ".png";
  a.click();
}

// ── SWITCH STATS VIEW ────────────────────────────────────────
function switchStatsView(view) {
  ["carbon", "statistik", "tahunan"].forEach((v) => {
    document.getElementById("cp-" + v)?.classList.remove("active");
    document.getElementById("snv-" + v)?.classList.remove("active");
  });
  document.getElementById("cp-" + view)?.classList.add("active");
  document.getElementById("snv-" + view)?.classList.add("active");
}

// ── SWITCH SUB-VIEW DALAM TREN TAHUNAN ───────────────────────
function switchTahunanView(view) {
  ["tren", "kelas", "nama", "tabel"].forEach((v) => {
    document.getElementById("typ-" + v)?.classList.remove("active");
    document.getElementById("tyv-" + v)?.classList.remove("active");
  });
  document.getElementById("typ-" + view)?.classList.add("active");
  document.getElementById("tyv-" + view)?.classList.add("active");
}

// ── DONUT CHART ──────────────────────────────────────────────
function renderDonutChart(classData) {
  const canvas = document.getElementById("chart-donut");
  const empty = document.getElementById("rp-chart-empty");
  if (!canvas) return;

  const entries = Object.entries(classData).filter(([, d]) => d.areaHa > 0);
  if (!entries.length) {
    if (empty) empty.style.display = "flex";
    return;
  }
  if (empty) empty.style.display = "none";

  const labels = entries.map(([, d]) => d.nameId || d.name);
  const areas = entries.map(([, d]) => +d.areaHa.toFixed(2));
  const colors = entries.map(
    ([code]) =>
      LANDCOVER_CLASS_VALUES[code]?.color ??
      IPCC_FOREST_TYPES[code]?.color ??
      NDVI_CARBON_CLASSES[code]?.color ??
      "#52b788",
  );

  if (_chartDonut) _chartDonut.destroy();

  _chartDonut = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: areas,
          backgroundColor: colors.map((c) => c + "cc"),
          borderColor: colors,
          borderWidth: 1.5,
          hoverOffset: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "58%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              ` ${ctx.label}: ${ctx.parsed.toLocaleString("id-ID")} ha`,
          },
        },
      },
    },
  });
}

// ── RIGHT PANEL ───────────────────────────────────────────────
function renderRightPanel(classData, agg, method) {
  const el = (id) => document.getElementById(id);
  const totalArea = Object.values(classData).reduce(
    (s, d) => s + (d.areaHa || 0),
    0,
  );

  // ── Per-method config ─────────────────────────────────────
  const cfg = {
    ipcc: {
      title: "Analisis Elevasi & Biomassa",
      donutLbl: "Distribusi Area per Elevasi",
      classLbl: "Per Kelas Elevasi",
      source: "IPCC 2019 Wetlands Supplement",
      showBiomass: true,
      showNdvi: false,
    },
    nfi: {
      title: "Analisis Tutupan Lahan",
      donutLbl: "Distribusi Area per Tutupan",
      classLbl: "Per Kelas Tutupan",
      source: "KLHK National Forest Inventory",
      showBiomass: true,
      showNdvi: false,
    },
    lefebvre: {
      title: "Analisis Stok Karbon per Nama Hutan",
      donutLbl: "Distribusi Stok Karbon",
      classLbl: "Per Nama Hutan",
      source: "Landsat 8 · Pre-computed Stock Carbon (tC/ha)",
      showBiomass: false,
      showNdvi: false,
    },
  };
  const c = cfg[method] || cfg.ipcc;

  // ── Update title & labels ──────────────────────────────────
  if (el("rp-title")) el("rp-title").textContent = c.title;
  if (el("rp-donut-lbl")) el("rp-donut-lbl").textContent = c.donutLbl;
  if (el("rp-class-lbl")) el("rp-class-lbl").textContent = c.classLbl;
  if (el("lbl-source")) el("lbl-source").textContent = c.source;

  // ── Stats ──────────────────────────────────────────────────
  if (el("rp-total-area"))
    el("rp-total-area").textContent =
      typeof fmtArea === "function"
        ? fmtArea(totalArea)
        : fmtDec(totalArea, 0) + " ha";
  if (el("rp-total-carbon"))
    el("rp-total-carbon").textContent = fmt(agg.total) + " tC";
  if (el("rp-total-co2"))
    el("rp-total-co2").textContent =
      fmt(agg.co2Equivalent || agg.total * 3.67) + " tCO₂";

  // ── Show/hide sections ─────────────────────────────────────
  const bioSec = el("rp-biomass-section");
  const ndviSec = el("rp-ndvi-section");
  const ndviStat = el("rp-ndvi-stat");
  const ndviDensStat = el("rp-ndvi-density-stat");
  if (bioSec) bioSec.style.display = c.showBiomass ? "" : "none";
  if (ndviSec) ndviSec.style.display = c.showNdvi ? "" : "none";
  if (ndviStat) ndviStat.style.display = c.showNdvi ? "" : "none";
  if (ndviDensStat) ndviDensStat.style.display = c.showNdvi ? "" : "none";

  // ── NDVI mean (Literature) ─────────────────────────────────
  if (c.showNdvi) {
    if (el("rp-ndvi-val")) {
      const mean = window.state?._ndviMean ?? window.state?.ndviMean;
      el("rp-ndvi-val").textContent =
        mean != null && !isNaN(mean) ? fmtDec(mean, 3) : "–";
    }
    // Rata-rata karbon density
    const rpNdviExtra = el("rp-ndvi-extra");
    if (rpNdviExtra) {
      const totalC = Object.values(classData).reduce(
        (s, d) => s + (d.carbon || 0),
        0,
      );
      const avgDens = totalArea > 0 ? (totalC / totalArea).toFixed(1) : "–";
      rpNdviExtra.textContent = `${avgDens} tC/ha rata-rata`;
    }
    // Render the Literature-specific NDVI stats breakdown bar
    _renderNdviBreakdownBar(classData, el("rp-ndvi-breakdown"));
  }

  // ── Donut chart: untuk Literature gunakan karbon (bukan area) ──
  if (method === "lefebvre") {
    renderDonutChartByCarbon(classData);
  } else {
    renderDonutChart(classData);
  }

  // ── Class list ─────────────────────────────────────────────
  const list = el("rp-class-list");
  if (!list) return;
  list.innerHTML = "";

  const entries = Object.entries(classData)
    .filter(([, d]) => d.areaHa > 0)
    .sort((a, b) => b[1].carbon - a[1].carbon);

  if (!entries.length) {
    list.innerHTML = '<div class="rp-empty">Belum ada data.</div>';
    return;
  }

  const maxCarbon = Math.max(...entries.map(([, d]) => d.carbon || 0));
  const totalC = entries.reduce((s, [, d]) => s + (d.carbon || 0), 0);

  // Subtitles per code
  const subs = {
    tropical_rainforest: "Dataran rendah < 1.000m dpl",
    tropical_mountain: "Dataran tinggi ≥ 1.000m dpl",
    lit_high: "NDVI ≥ 0.65",
    lit_medium: "NDVI 0.50 – 0.65",
    lit_low: "NDVI < 0.50",
  };
  // Badge label + style per code
  const badges = {
    tropical_rainforest: { lbl: "Low Elev", cls: "low" },
    tropical_mountain: { lbl: "High Elev", cls: "high" },
    lit_high: { lbl: "Tinggi", cls: "high" },
    lit_medium: { lbl: "Sedang", cls: "mid" },
    lit_low: { lbl: "Rendah", cls: "low" },
  };

  entries.forEach(([code, d]) => {
    const cl =
      LANDCOVER_CLASS_VALUES[code] ??
      IPCC_FOREST_TYPES[code] ??
      NDVI_CARBON_CLASSES[code];
    // Literature: gunakan d.color (warna per nama hutan dari _namaColor)
    const color = (method === "lefebvre" ? d.color : null) ?? cl?.color ?? "#52b788";
    const sharePct = totalC > 0 ? Math.round((d.carbon / totalC) * 100) : 0;
    const barPct =
      maxCarbon > 0 ? ((d.carbon / maxCarbon) * 100).toFixed(1) : 0;
    const name =
      method === "lefebvre"
        ? d.name
        : (typeof _lang !== "undefined" && _lang === "id"
          ? cl?.nameId || d.name
          : d.name);
    const sub =
      subs[code] ??
      (d.areaHa > 0 ? `${(d.carbon / d.areaHa).toFixed(2)} tC/ha` : "");
    const badge = badges[code];

    // Reference values per class
    const agbHa = cl?.agb ?? 0;
    const bgbHa = cl?.bgb ?? 0;
    let refVals = "";
    if (method === "lefebvre") {
      // Literature per-nama: tampilkan densitas karbon per ha
      const dens = d.areaHa > 0 ? (d.carbon / d.areaHa).toFixed(2) : "0";
      refVals = `<div class="rtc-ref">
        <span class="rtc-dens-pill" style="background:${color}22;border:1px solid ${color}55;color:${color}">
          ${dens} tC/ha
        </span>
      </div>`;
    } else if (agbHa > 0 || bgbHa > 0) {
      refVals = `<div class="rtc-ref">
        AGB: <strong>${agbHa}</strong>&nbsp;·&nbsp;BGB: <strong>${bgbHa}</strong>
        <span class="rtc-unit">Mg/ha</span>
      </div>`;
    }

    const badgeHtml = badge
      ? `<span class="rtc-badge ${badge.cls}">${badge.lbl}</span>`
      : `<span class="rtc-badge pct">${sharePct}%</span>`;

    // Untuk Literature, tampilkan 3 metrics (luas, karbon total, persen karbon)
    let metricsHtml = "";
    if (method === "lefebvre") {
      metricsHtml = `
        <div class="rtc-metrics">
          <div class="rtc-metric">
            <div class="rtc-mv">${typeof fmtArea === "function" ? fmtArea(d.areaHa) : fmtDec(d.areaHa, 0) + " ha"}</div>
            <div class="rtc-mk">Luas</div>
          </div>
          <div class="rtc-metric">
            <div class="rtc-mv" style="color:${color}">${d.carbon >= 1 ? fmt(d.carbon) : d.carbon.toFixed(2)}</div>
            <div class="rtc-mk">tC</div>
          </div>
          <div class="rtc-metric">
            <div class="rtc-mv">${sharePct}%</div>
            <div class="rtc-mk">Kontribusi</div>
          </div>
        </div>`;
    } else {
      metricsHtml = `
        <div class="rtc-metrics">
          <div class="rtc-metric">
            <div class="rtc-mv">${typeof fmtArea === "function" ? fmtArea(d.areaHa) : fmtDec(d.areaHa, 0) + " ha"}</div>
            <div class="rtc-mk">Luas</div>
          </div>
        </div>`;
    }

    const card = document.createElement("div");
    card.className = "rp-type-card";
    card.style.borderLeftColor = color;
    card.innerHTML = `
      <div class="rtc-top">
        <div class="rtc-info">
          <div class="rtc-name">${name}</div>
          <div class="rtc-sub">${sub}</div>
          ${refVals}
        </div>
        ${badgeHtml}
      </div>
      ${metricsHtml}
      <div class="rtc-carbon-row">
        <span class="rtc-clbl">Total Karbon</span>
        <div class="rp-ci-bar-bg rtc-bar">
          <div class="rp-ci-bar" style="width:${barPct}%;background:${color}"></div>
        </div>
        <span class="rtc-cv">${fmt(d.carbon)} tC</span>
      </div>
    `;
    list.appendChild(card);
  });
}

// ── NDVI Breakdown Bar (Literature only) ──────────────────────
function _renderNdviBreakdownBar(classData, container) {
  if (!container) return;
  const totalC = Object.values(classData).reduce((s, d) => s + (d.carbon || 0), 0);
  if (totalC <= 0) { container.innerHTML = ""; return; }

  const classes = [
    { key: "lit_high",   label: "Tinggi",  color: "#0d4a27" },
    { key: "lit_medium", label: "Sedang",  color: "#4caf50" },
    { key: "lit_low",    label: "Rendah",  color: "#c8e6c9" },
  ];

  let html = `<div class="ndvi-bar-stack">`;
  classes.forEach(({ key, label, color }) => {
    const d = classData[key];
    if (!d || d.carbon <= 0) return;
    const pct = ((d.carbon / totalC) * 100).toFixed(1);
    html += `<div class="ndvi-bar-seg" style="width:${pct}%;background:${color}" title="${label}: ${pct}% (${fmt(d.carbon)} tC)"></div>`;
  });
  html += `</div><div class="ndvi-bar-labels">`;
  classes.forEach(({ key, label, color }) => {
    const d = classData[key];
    if (!d || d.carbon <= 0) return;
    const pct = ((d.carbon / totalC) * 100).toFixed(0);
    html += `<span class="ndvi-bar-lbl"><span class="ndvi-lbl-dot" style="background:${color}"></span>${label} ${pct}%</span>`;
  });
  html += `</div>`;
  container.innerHTML = html;
}

// ── DONUT CHART (by Carbon for Literature) ────────────────────
function renderDonutChartByCarbon(classData) {
  const canvas = document.getElementById("chart-donut");
  const empty = document.getElementById("rp-chart-empty");
  if (!canvas) return;

  const entries = Object.entries(classData).filter(([, d]) => d.carbon > 0);
  if (!entries.length) {
    if (empty) empty.style.display = "flex";
    return;
  }
  if (empty) empty.style.display = "none";

  const labels = entries.map(([, d]) => d.nameId || d.name);
  const carbons = entries.map(([, d]) => +d.carbon.toFixed(2));
  const colors = entries.map(
    ([code]) =>
      NDVI_CARBON_CLASSES[code]?.color ??
      LANDCOVER_CLASS_VALUES[code]?.color ??
      IPCC_FOREST_TYPES[code]?.color ??
      "#52b788",
  );

  if (_chartDonut) _chartDonut.destroy();

  _chartDonut = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: carbons,
          backgroundColor: colors.map((c) => c + "cc"),
          borderColor: colors,
          borderWidth: 1.5,
          hoverOffset: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "58%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              ` ${ctx.label}: ${ctx.parsed.toLocaleString("id-ID")} tC`,
          },
        },
      },
    },
  });
}

// ── FOREST DONUT CHART (bottom-bar: per kelas hutan) ─────────
let _chartForestDonut = null;
function renderForestDonutChart(byKelas) {
  const canvas = document.getElementById("chart-forest-donut");
  const empty = document.getElementById("bb-donut-empty");
  if (!canvas) return;

  const entries = Object.entries(byKelas).filter(([, v]) => v > 0);
  if (!entries.length) {
    if (empty) empty.style.display = "flex";
    return;
  }
  if (empty) empty.style.display = "none";

  const labels = entries.map(([k]) => k);
  const values = entries.map(([, v]) => +v.toFixed(2));
  const kelasColors = [
    "#1a6b2e", "#00897b", "#e67e00", "#7b1fa2",
    "#0288d1", "#f9a825", "#5d4037", "#d32f2f",
  ];
  const colors = entries.map((_, i) => kelasColors[i % kelasColors.length]);

  if (_chartForestDonut) _chartForestDonut.destroy();

  _chartForestDonut = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors.map((c) => c + "cc"),
        borderColor: colors,
        borderWidth: 1.5,
        hoverOffset: 5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "60%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${Math.round(ctx.parsed).toLocaleString("id-ID")} tC`,
          },
        },
      },
    },
  });
}

// ── FOREST STATS TABLE (tab Per Hutan) ───────────────────────
function renderForestStatsTable(forestData) {
  const tbody = document.getElementById("forest-stats-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const palette = typeof FOREST_NAME_PALETTE !== "undefined" ? FOREST_NAME_PALETTE : [];
  const namaColorMap = (typeof state !== "undefined" && state._namaColorMap) || {};
  forestData.forEach((d, i) => {
    const color = namaColorMap[d.nama] || palette[i % palette.length] || "#52b788";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:5px;vertical-align:middle"></span>${d.nama}</td>
      <td>${d.kelas}</td>
      <td>${(+d.totalArea.toFixed(2)).toLocaleString("id-ID")}</td>
      <td>${d.totalCarbon >= 1 ? Math.round(d.totalCarbon).toLocaleString("id-ID") : d.totalCarbon.toFixed(2)}</td>
      <td>${(d.totalCarbon * 3.67) >= 1 ? Math.round(d.totalCarbon * 3.67).toLocaleString("id-ID") : (d.totalCarbon * 3.67).toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ── TREN TAHUNAN: LINE CHART (total, AGB, BGB) ───────────────
let _chartTrend = null;
function renderMultiYearTrendChart(carbonByYear) {
  const canvas = document.getElementById("chart-trend");
  const empty  = document.getElementById("chart-empty-trend");
  if (!canvas) return;

  const years = Object.keys(carbonByYear).sort();
  if (!years.length) { if (empty) empty.style.display = "flex"; return; }
  if (empty) empty.style.display = "none";

  const totalData = years.map((y) => Math.round(carbonByYear[y].totalCarbon));
  const agbData   = years.map((y) => Math.round(carbonByYear[y].agb));
  const bgbData   = years.map((y) => Math.round(carbonByYear[y].bgb));

  if (_chartTrend) { _chartTrend.destroy(); _chartTrend = null; }

  _chartTrend = new Chart(canvas, {
    type: "line",
    data: {
      labels: years,
      datasets: [
        {
          label: "Total Carbon (tC)",
          data: totalData,
          borderColor: "#0d9488",
          backgroundColor: "rgba(13,148,136,0.12)",
          borderWidth: 2.5,
          pointRadius: 5,
          pointBackgroundColor: "#0d9488",
          fill: true,
          tension: 0.35,
          yAxisID: "y",
        },
        {
          label: "AGB (tC)",
          data: agbData,
          borderColor: "#4caf50",
          backgroundColor: "transparent",
          borderWidth: 1.5,
          borderDash: [6, 3],
          pointRadius: 4,
          pointBackgroundColor: "#4caf50",
          fill: false,
          tension: 0.35,
          yAxisID: "y",
        },
        {
          label: "BGB (tC)",
          data: bgbData,
          borderColor: "#81c784",
          backgroundColor: "transparent",
          borderWidth: 1.5,
          borderDash: [3, 3],
          pointRadius: 4,
          pointBackgroundColor: "#81c784",
          fill: false,
          tension: 0.35,
          yAxisID: "y",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: { color: "#ccc", font: { size: 12 }, boxWidth: 22 },
        },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString("id-ID")} tC`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: "#aaa", font: { size: 11 } },
          grid:  { color: "rgba(255,255,255,0.05)" },
        },
        y: {
          ticks: {
            color: "#aaa",
            font: { size: 11 },
            callback: (v) => {
              if (v >= 1e6) return (v / 1e6).toFixed(1) + " Jt tC";
              if (v >= 1e3) return (v / 1e3).toFixed(0) + " Rb tC";
              return v;
            },
          },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
      },
    },
  });
}

// ── TREN TAHUNAN: STACKED BAR PER KELAS + TABEL RINCIAN ──────
let _chartTrendKelas = null;
function renderMultiYearClassChart(carbonByYear) {
  const canvas = document.getElementById("chart-trend-kelas");
  const empty  = document.getElementById("chart-empty-kelas");
  if (!canvas) return;

  const years = Object.keys(carbonByYear).sort();
  if (!years.length) { if (empty) empty.style.display = "flex"; return; }
  if (empty) empty.style.display = "none";

  // Kumpulkan semua class codes
  const codeSet = new Set();
  years.forEach((y) => Object.keys(carbonByYear[y].byClass).forEach((c) => codeSet.add(+c)));
  const codes = Array.from(codeSet).sort((a, b) => a - b);

  const lcv = typeof LANDCOVER_CLASS_VALUES !== "undefined" ? LANDCOVER_CLASS_VALUES : {};
  const CF  = 0.47;

  // Hitung total karbon seluruh tahun (untuk %)
  const grandTotal = years.reduce((s, y) => s + carbonByYear[y].totalCarbon, 0);

  const datasets = codes.map((code) => {
    const entry = lcv[code] || {};
    const yearVals = years.map((y) => Math.round(carbonByYear[y].byClass[code]?.carbon || 0));
    return {
      label: entry.nameId || entry.name || `Kelas ${code}`,
      data: yearVals,
      backgroundColor: (entry.color || "#52b788") + "cc",
      borderColor: entry.color || "#52b788",
      borderWidth: 1,
      _code: code,
    };
  });

  if (_chartTrendKelas) { _chartTrendKelas.destroy(); _chartTrendKelas = null; }

  _chartTrendKelas = new Chart(canvas, {
    type: "bar",
    data: { labels: years, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: { color: "#ccc", font: { size: 11 }, boxWidth: 14, padding: 8 },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val  = ctx.parsed.y;
              const tot  = ctx.chart.data.datasets.reduce((s, ds) => s + (ds.data[ctx.dataIndex] || 0), 0);
              const pct  = tot > 0 ? ((val / tot) * 100).toFixed(1) : "0.0";
              return ` ${ctx.dataset.label}: ${val.toLocaleString("id-ID")} tC (${pct}%)`;
            },
            footer: (items) => {
              const tot = items.reduce((s, i) => s + i.parsed.y, 0);
              return `Total ${items[0].label}: ${tot.toLocaleString("id-ID")} tC`;
            },
          },
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: "#aaa", font: { size: 11 } }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: {
          stacked: true,
          ticks: {
            color: "#aaa", font: { size: 11 },
            callback: (v) => {
              if (v >= 1e6) return (v / 1e6).toFixed(1) + " Jt";
              if (v >= 1e3) return (v / 1e3).toFixed(0) + " Rb";
              return v;
            },
          },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
      },
    },
  });

  // ── Tabel rincian faktor per kelas ───────────────────────────
  const tbody = document.getElementById("tbody-kelas-detail");
  if (!tbody) return;
  tbody.innerHTML = "";

  codes.forEach((code) => {
    const entry = lcv[code] || {};
    const agb   = entry.agb || 0;
    const bgb   = entry.bgb || 0;
    const bio   = agb + bgb;
    const color = entry.color || "#52b788";
    const name  = entry.nameId || entry.name || `Kelas ${code}`;

    // Rata-rata area & carbon per tahun
    const avgArea   = years.reduce((s, y) => s + (carbonByYear[y].byClass[code]?.areaHa  || 0), 0) / years.length;
    const avgCarbon = years.reduce((s, y) => s + (carbonByYear[y].byClass[code]?.carbon  || 0), 0) / years.length;
    const totalCarbonKelas = years.reduce((s, y) => s + (carbonByYear[y].byClass[code]?.carbon || 0), 0);
    const pctOfTotal = grandTotal > 0 ? ((totalCarbonKelas / grandTotal) * 100).toFixed(1) : "0.0";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${color};margin-right:6px;vertical-align:middle"></span>
        <strong>${name}</strong>
      </td>
      <td style="text-align:right">${agb.toFixed(2)}</td>
      <td style="text-align:right">${bgb.toFixed(2)}</td>
      <td style="text-align:center">${CF}</td>
      <td style="text-align:right">${bio.toFixed(2)}</td>
      <td style="text-align:right">${Math.round(avgArea).toLocaleString("id-ID")}</td>
      <td class="td-carbon" style="text-align:right">${Math.round(avgCarbon).toLocaleString("id-ID")}</td>
      <td style="text-align:center"><strong>${pctOfTotal}%</strong></td>
    `;
    tbody.appendChild(tr);
  });

  // Baris total
  const totArea   = years.reduce((s, y) => s + carbonByYear[y].totalAreaHa, 0) / years.length;
  const totCarbon = grandTotal / years.length;
  const trTot = document.createElement("tr");
  trTot.style.background = "rgba(13,148,136,0.08)";
  trTot.innerHTML = `
    <td><strong>TOTAL</strong></td>
    <td colspan="4" style="text-align:center;color:var(--text-muted);font-size:11px">
      — rata-rata semua kelas —
    </td>
    <td style="text-align:right"><strong>${Math.round(totArea).toLocaleString("id-ID")}</strong></td>
    <td class="td-carbon" style="text-align:right"><strong>${Math.round(totCarbon).toLocaleString("id-ID")}</strong></td>
    <td style="text-align:center"><strong>100%</strong></td>
  `;
  tbody.appendChild(trTot);
}

// ── TREN TAHUNAN: TABEL LENGKAP (breakdown per kelas per tahun)
function renderMultiYearTable(carbonByYear) {
  const tbody = document.getElementById("tbody-tahunan");
  if (!tbody) return;

  const years = Object.keys(carbonByYear).sort();
  if (!years.length) return;

  const lcv = typeof LANDCOVER_CLASS_VALUES !== "undefined" ? LANDCOVER_CLASS_VALUES : {};

  // Kumpulkan semua kode kelas yang pernah muncul, urutkan
  const codeSet = new Set();
  years.forEach((y) => Object.keys(carbonByYear[y].byClass).forEach((c) => codeSet.add(+c)));
  const codes = Array.from(codeSet).sort((a, b) => a - b);

  tbody.innerHTML = "";

  // prevCarbon per tahun (total), per kelas, per nama hutan
  let prevTotalCarbon = null;
  const prevClassCarbon = {}; // code → carbon tahun sebelumnya
  const prevNamaCarbon  = {}; // key  → carbon tahun sebelumnya

  years.forEach((yr) => {
    const d = carbonByYear[yr];

    // ── Baris header tahun ──────────────────────────────────────
    let deltaHtml = "–";
    if (prevTotalCarbon !== null) {
      const pct  = ((d.totalCarbon - prevTotalCarbon) / prevTotalCarbon) * 100;
      const sign = pct >= 0 ? "+" : "";
      const cls  = pct >= 0 ? "td-pos" : "td-neg";
      deltaHtml  = `<span class="${cls}">${sign}${pct.toFixed(1)}%</span>`;
    }

    const trYear = document.createElement("tr");
    trYear.className = "tr-year-header";
    trYear.innerHTML = `
      <td class="td-yr" rowspan="1">${yr}</td>
      <td><strong>— Semua Kelas —</strong></td>
      <td style="text-align:right"><strong>${Math.round(d.totalAreaHa).toLocaleString("id-ID")}</strong></td>
      <td style="text-align:right"><strong>${Math.round(d.agb).toLocaleString("id-ID")}</strong></td>
      <td style="text-align:right"><strong>${Math.round(d.bgb).toLocaleString("id-ID")}</strong></td>
      <td class="td-carbon" style="text-align:right"><strong>${Math.round(d.totalCarbon).toLocaleString("id-ID")}</strong></td>
      <td class="td-co2"   style="text-align:right"><strong>${Math.round(d.co2).toLocaleString("id-ID")}</strong></td>
      <td style="text-align:center">${deltaHtml}</td>
    `;
    tbody.appendChild(trYear);

    // ── Sub-baris per kelas tutupan lahan ──────────────────────
    const trSepKelas = document.createElement("tr");
    trSepKelas.className = "tr-sep-label";
    trSepKelas.innerHTML = `<td></td><td colspan="7" style="font-size:10px;font-weight:600;color:var(--text-muted);padding:4px 8px;text-transform:uppercase;letter-spacing:0.05em">Per Tutupan Lahan</td>`;
    tbody.appendChild(trSepKelas);

    codes.forEach((code) => {
      const cls   = d.byClass[code];
      if (!cls || !cls.carbon) return;

      const entry = lcv[code] || {};
      const color = entry.color || "#aaa";
      const name  = entry.nameId || entry.name || `Kelas ${code}`;

      let clsDeltaHtml = "–";
      if (prevClassCarbon[code] != null && prevClassCarbon[code] > 0) {
        const pct  = ((cls.carbon - prevClassCarbon[code]) / prevClassCarbon[code]) * 100;
        const sign = pct >= 0 ? "+" : "";
        const dc   = pct >= 0 ? "td-pos" : "td-neg";
        clsDeltaHtml = `<span class="${dc}">${sign}${pct.toFixed(1)}%</span>`;
      }

      const pctTot = d.totalCarbon > 0 ? ((cls.carbon / d.totalCarbon) * 100).toFixed(1) : "0.0";

      const trCls = document.createElement("tr");
      trCls.className = "tr-class-row";
      trCls.innerHTML = `
        <td style="padding-left:16px;color:var(--text-muted);font-size:11px">↳</td>
        <td>
          <span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:5px;vertical-align:middle"></span>
          ${name}
          <span style="color:var(--text-muted);font-size:10px;margin-left:4px">(${pctTot}%)</span>
        </td>
        <td style="text-align:right">${Math.round(cls.areaHa).toLocaleString("id-ID")}</td>
        <td style="text-align:right">${Math.round(cls.agb).toLocaleString("id-ID")}</td>
        <td style="text-align:right">${Math.round(cls.bgb).toLocaleString("id-ID")}</td>
        <td class="td-carbon" style="text-align:right">${Math.round(cls.carbon).toLocaleString("id-ID")}</td>
        <td class="td-co2"   style="text-align:right">${Math.round(cls.carbon * 3.67).toLocaleString("id-ID")}</td>
        <td style="text-align:center">${clsDeltaHtml}</td>
      `;
      tbody.appendChild(trCls);
      prevClassCarbon[code] = cls.carbon;
    });

    // ── Sub-baris per nama hutan ────────────────────────────────
    const namaEntries = Object.entries(d.byNama || {})
      .filter(([, nd]) => nd.totalCarbon > 0)
      .sort(([, a], [, b]) => b.totalCarbon - a.totalCarbon);

    if (namaEntries.length) {
      const trSepNama = document.createElement("tr");
      trSepNama.className = "tr-sep-label";
      trSepNama.innerHTML = `<td></td><td colspan="7" style="font-size:10px;font-weight:600;color:var(--text-muted);padding:4px 8px;text-transform:uppercase;letter-spacing:0.05em">Per Nama Hutan</td>`;
      tbody.appendChild(trSepNama);

      namaEntries.forEach(([key, nd]) => {
        const pctTot = d.totalCarbon > 0 ? ((nd.totalCarbon / d.totalCarbon) * 100).toFixed(1) : "0.0";

        let namaDeltaHtml = "–";
        if (prevNamaCarbon[key] != null && prevNamaCarbon[key] > 0) {
          const pct  = ((nd.totalCarbon - prevNamaCarbon[key]) / prevNamaCarbon[key]) * 100;
          const sign = pct >= 0 ? "+" : "";
          const dc   = pct >= 0 ? "td-pos" : "td-neg";
          namaDeltaHtml = `<span class="${dc}">${sign}${pct.toFixed(1)}%</span>`;
        }

        // Warna dari palette nama hutan
        const palette = typeof FOREST_NAME_PALETTE !== "undefined" ? FOREST_NAME_PALETTE : [];
        const namaColorMap = (typeof state !== "undefined" && state._namaColorMap) || {};
        const namaColor = namaColorMap[nd.nama] || palette[namaEntries.indexOf([key, nd]) % palette.length] || "#52b788";

        const trNama = document.createElement("tr");
        trNama.className = "tr-class-row";
        trNama.innerHTML = `
          <td style="padding-left:16px;color:var(--text-muted);font-size:11px">↳</td>
          <td>
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${namaColor};margin-right:5px;vertical-align:middle"></span>
            ${nd.nama}
            <span style="color:var(--text-muted);font-size:10px;margin-left:4px">[${nd.kelas}]</span>
            <span style="color:var(--text-muted);font-size:10px;margin-left:2px">(${pctTot}%)</span>
          </td>
          <td style="text-align:right">${Math.round(nd.totalArea).toLocaleString("id-ID")}</td>
          <td style="text-align:right">${Math.round(nd.agb).toLocaleString("id-ID")}</td>
          <td style="text-align:right">${Math.round(nd.bgb).toLocaleString("id-ID")}</td>
          <td class="td-carbon" style="text-align:right">${Math.round(nd.totalCarbon).toLocaleString("id-ID")}</td>
          <td class="td-co2"   style="text-align:right">${Math.round(nd.totalCarbon * 3.67).toLocaleString("id-ID")}</td>
          <td style="text-align:center">${namaDeltaHtml}</td>
        `;
        tbody.appendChild(trNama);
        prevNamaCarbon[key] = nd.totalCarbon;
      });
    }

    prevTotalCarbon = d.totalCarbon;
  });

  // ── Baris rata-rata keseluruhan ─────────────────────────────
  const n      = years.length;
  const avgC   = years.reduce((s, y) => s + carbonByYear[y].totalCarbon, 0) / n;
  const avgArea = years.reduce((s, y) => s + carbonByYear[y].totalAreaHa, 0) / n;
  const avgAGB  = years.reduce((s, y) => s + carbonByYear[y].agb, 0) / n;
  const avgBGB  = years.reduce((s, y) => s + carbonByYear[y].bgb, 0) / n;
  const avgCO2  = avgC * 3.67;

  const trAvg = document.createElement("tr");
  trAvg.className = "tr-avg-row";
  trAvg.innerHTML = `
    <td class="td-yr">Avg</td>
    <td><em>Rata-rata 2015–2024</em></td>
    <td style="text-align:right">${Math.round(avgArea).toLocaleString("id-ID")}</td>
    <td style="text-align:right">${Math.round(avgAGB).toLocaleString("id-ID")}</td>
    <td style="text-align:right">${Math.round(avgBGB).toLocaleString("id-ID")}</td>
    <td class="td-carbon" style="text-align:right">${Math.round(avgC).toLocaleString("id-ID")}</td>
    <td class="td-co2"   style="text-align:right">${Math.round(avgCO2).toLocaleString("id-ID")}</td>
    <td style="text-align:center">–</td>
  `;
  tbody.appendChild(trAvg);
}

// ── PER KELAS: MULTI-LINE CHART (1 garis per kelas) ──────────
let _chartKelasLine = null;
function renderMultiYearKelasLineChart(carbonByYear) {
  const canvas = document.getElementById("chart-kelas-line");
  if (!canvas) return;

  const years = Object.keys(carbonByYear).sort();
  if (!years.length) return;

  const lcv    = typeof LANDCOVER_CLASS_VALUES !== "undefined" ? LANDCOVER_CLASS_VALUES : {};
  const codeSet = new Set();
  years.forEach((y) => Object.keys(carbonByYear[y].byClass).forEach((c) => codeSet.add(+c)));
  const codes = Array.from(codeSet).sort((a, b) => a - b);

  const datasets = codes.map((code) => {
    const entry = lcv[code] || {};
    const color = entry.color || "#52b788";
    return {
      label: entry.nameId || entry.name || `Kelas ${code}`,
      data:  years.map((y) => Math.round(carbonByYear[y].byClass[code]?.carbon || 0)),
      borderColor: color,
      backgroundColor: color + "22",
      borderWidth: 2,
      pointRadius: 4,
      pointBackgroundColor: color,
      fill: false,
      tension: 0.3,
    };
  });

  if (_chartKelasLine) { _chartKelasLine.destroy(); _chartKelasLine = null; }

  _chartKelasLine = new Chart(canvas, {
    type: "line",
    data: { labels: years, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true, position: "right",
          labels: { color: "#ccc", font: { size: 11 }, boxWidth: 14, padding: 8 },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              const tot = ctx.chart.data.datasets.reduce((s, ds) => s + (ds.data[ctx.dataIndex] || 0), 0);
              const pct = tot > 0 ? ((v / tot) * 100).toFixed(1) : "0.0";
              return ` ${ctx.dataset.label}: ${v.toLocaleString("id-ID")} tC (${pct}%)`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: "#aaa", font: { size: 11 } }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: {
          ticks: {
            color: "#aaa", font: { size: 11 },
            callback: (v) => v >= 1e6 ? (v / 1e6).toFixed(1) + " Jt" : v >= 1e3 ? (v / 1e3).toFixed(0) + " Rb" : v,
          },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
      },
    },
  });
}

// ── PER NAMA HUTAN: MULTI-LINE CHART (top 15) + TABEL ─────────
let _chartNamaLine = null;
function renderNamaHutanChart(carbonByYear) {
  const canvas = document.getElementById("chart-nama-line");
  const empty  = document.getElementById("chart-empty-nama");
  const tbody  = document.getElementById("tbody-nama-summary");
  if (!canvas) return;

  const years = Object.keys(carbonByYear).sort();
  if (!years.length) { if (empty) empty.style.display = "flex"; return; }

  // Hitung rata-rata carbon per nama hutan lintas semua tahun
  const namaMap = {}; // key → {nama, kelas, carbonPerYear:[], totalArea}
  years.forEach((y) => {
    Object.entries(carbonByYear[y].byNama || {}).forEach(([key, nd]) => {
      if (!namaMap[key]) namaMap[key] = { nama: nd.nama, kelas: nd.kelas, totalArea: nd.totalArea, vals: [] };
      namaMap[key].vals.push(nd.totalCarbon || 0);
    });
  });

  // Hitung avg, sort descending, ambil top 15
  const sorted = Object.entries(namaMap)
    .map(([key, d]) => ({ key, ...d, avg: d.vals.reduce((s, v) => s + v, 0) / d.vals.length }))
    .sort((a, b) => b.avg - a.avg);

  const top15 = sorted.slice(0, 15);

  if (empty) empty.style.display = "none";

  // Palette warna konsisten
  const palette = [
    "#1a6b2e","#00897b","#e67e00","#7b1fa2","#0288d1","#f9a825",
    "#5d4037","#d32f2f","#2e7d32","#00695c","#6a1b9a","#c62828",
    "#0277bd","#f57f17","#4e342e",
  ];
  const namaColorMap = (typeof state !== "undefined" && state._namaColorMap) || {};

  const datasets = top15.map((d, i) => {
    const color = namaColorMap[d.nama] || palette[i % palette.length];
    return {
      label: d.nama.length > 28 ? d.nama.slice(0, 26) + "…" : d.nama,
      data:  years.map((y) => Math.round(carbonByYear[y].byNama?.[d.key]?.totalCarbon || 0)),
      borderColor: color,
      backgroundColor: color + "22",
      borderWidth: 1.8,
      pointRadius: 3.5,
      pointBackgroundColor: color,
      fill: false,
      tension: 0.3,
    };
  });

  if (_chartNamaLine) { _chartNamaLine.destroy(); _chartNamaLine = null; }

  _chartNamaLine = new Chart(canvas, {
    type: "line",
    data: { labels: years, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true, position: "right",
          labels: { color: "#ccc", font: { size: 10 }, boxWidth: 12, padding: 6 },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString("id-ID")} tC`,
          },
        },
      },
      scales: {
        x: { ticks: { color: "#aaa", font: { size: 11 } }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: {
          ticks: {
            color: "#aaa", font: { size: 11 },
            callback: (v) => v >= 1e6 ? (v / 1e6).toFixed(2) + " Jt" : v >= 1e3 ? (v / 1e3).toFixed(0) + " Rb" : v,
          },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
      },
    },
  });

  // ── Tabel ringkasan semua nama hutan ──────────────────────────
  if (!tbody) return;
  tbody.innerHTML = "";
  sorted.forEach((d, i) => {
    const color   = namaColorMap[d.nama] || palette[i % palette.length];
    const minC    = Math.min(...d.vals.filter((v) => v > 0));
    const maxC    = Math.max(...d.vals);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="text-align:center;color:var(--text-muted)">${i + 1}</td>
      <td>
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:5px;vertical-align:middle"></span>
        ${d.nama}
      </td>
      <td style="color:var(--text-muted);font-size:11px">${d.kelas}</td>
      <td style="text-align:right">${Math.round(d.totalArea).toLocaleString("id-ID")}</td>
      <td class="td-carbon" style="text-align:right">${Math.round(d.avg).toLocaleString("id-ID")}</td>
      <td class="td-co2"   style="text-align:right">${Math.round(d.avg * 3.67).toLocaleString("id-ID")}</td>
      <td style="text-align:right;color:#ef5350">${Math.round(minC).toLocaleString("id-ID")}</td>
      <td style="text-align:right;color:#4caf50">${Math.round(maxC).toLocaleString("id-ID")}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ── WRAPPER: render semua komponen multi-tahun ────────────────
function renderMultiYearCharts(carbonByYear) {
  renderMultiYearTrendChart(carbonByYear);
  renderMultiYearKelasLineChart(carbonByYear);
  renderMultiYearClassChart(carbonByYear);
  renderNamaHutanChart(carbonByYear);
  renderMultiYearTable(carbonByYear);
}

// ── EXPORT PDF TREN TAHUNAN ──────────────────────────────────
function exportTahunanPDF() {
  const carbonByYear = (typeof state !== "undefined") ? state.carbonByYear : null;
  if (!carbonByYear || Object.keys(carbonByYear).length === 0) {
    alert('Data tren tahunan belum tersedia.\nKlik "Tren Tahunan" terlebih dahulu.');
    return;
  }
  if (!window.jspdf) {
    alert("Library jsPDF belum termuat. Pastikan koneksi internet aktif.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  // A4 landscape: 297 × 210 mm
  const lcv   = typeof LANDCOVER_CLASS_VALUES !== "undefined" ? LANDCOVER_CLASS_VALUES : {};
  const years = Object.keys(carbonByYear).sort();
  const N     = (v) => Math.round(v).toLocaleString("id-ID");
  const CO2_F = 3.67;
  const TEAL  = [16, 107, 90];
  const TEAL_LIGHT = [230, 245, 240];
  const dateStr = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });

  // ── fungsi cetak header halaman ────────────────────────────
  function pageHeader(doc, subtitle) {
    doc.setFillColor(...TEAL);
    doc.rect(0, 0, 297, 18, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Laporan Tren Stok Karbon 2015 \u2013 2024", 14, 11);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.text(`${subtitle} \u00B7 ${dateStr}`, 14, 16.5);
    doc.setTextColor(40, 40, 40);
  }

  // ── Halaman 1: Ringkasan Per Tahun ─────────────────────────
  pageHeader(doc, "Data KLHK (MapBiomas)");

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Ringkasan Per Tahun", 14, 24);

  const sumHead = [["Tahun", "Total Area (ha)", "AGB (tC)", "BGB (tC)", "Total Carbon (tC)", "CO\u2082eq (tCO\u2082)", "\u0394 Carbon"]];
  const sumBody = [];
  let prevTotal = null;
  for (const yr of years) {
    const d = carbonByYear[yr];
    let delta = "\u2013";
    if (prevTotal !== null) {
      const pct = ((d.totalCarbon - prevTotal) / prevTotal * 100).toFixed(1);
      delta = (d.totalCarbon >= prevTotal ? "+" : "") + pct + "%";
    }
    sumBody.push([yr, N(d.totalAreaHa), N(d.agb), N(d.bgb), N(d.totalCarbon), N(d.co2), delta]);
    prevTotal = d.totalCarbon;
  }
  doc.autoTable({
    head: sumHead, body: sumBody, startY: 27,
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: TEAL, textColor: 255, fontStyle: "bold", halign: "center" },
    alternateRowStyles: { fillColor: TEAL_LIGHT },
    columnStyles: {
      0: { cellWidth: 16, halign: "center", fontStyle: "bold" },
      1: { halign: "right" }, 2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right", fontStyle: "bold", textColor: TEAL },
      5: { halign: "right" },
      6: { halign: "center", cellWidth: 20 },
    },
    margin: { left: 14, right: 14 },
  });

  // ── Halaman 2: Per Tutupan Lahan ───────────────────────────
  doc.addPage();
  pageHeader(doc, "Per Tutupan Lahan");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Breakdown Per Tutupan Lahan per Tahun", 14, 24);

  const codeSet = new Set();
  years.forEach((y) => Object.keys(carbonByYear[y].byClass).forEach((c) => codeSet.add(+c)));
  const codes = Array.from(codeSet).sort((a, b) => a - b);

  const kelHead = [["Tahun", "Kelas Tutupan", "Kode", "Area (ha)", "AGB (tC)", "BGB (tC)", "Total Carbon (tC)", "CO\u2082eq (tCO\u2082)", "\u0394", "% Total"]];
  const kelBody = [];
  const prevKelasC = {};
  for (const yr of years) {
    const d = carbonByYear[yr];
    let firstOfYear = true;
    codes.forEach((code) => {
      const cls = d.byClass[code];
      if (!cls || !cls.carbon) return;
      const entry = lcv[code] || {};
      const name  = entry.nameId || entry.name || `Kelas ${code}`;
      const pct   = d.totalCarbon > 0 ? (cls.carbon / d.totalCarbon * 100).toFixed(1) : "0.0";
      let delta = "\u2013";
      if (prevKelasC[code] != null && prevKelasC[code] > 0) {
        const p = ((cls.carbon - prevKelasC[code]) / prevKelasC[code] * 100).toFixed(1);
        delta = (cls.carbon >= prevKelasC[code] ? "+" : "") + p + "%";
      }
      kelBody.push([firstOfYear ? yr : "", name, code, N(cls.areaHa), N(cls.agb), N(cls.bgb), N(cls.carbon), N(cls.carbon * CO2_F), delta, pct + "%"]);
      prevKelasC[code] = cls.carbon;
      firstOfYear = false;
    });
  }
  doc.autoTable({
    head: kelHead, body: kelBody, startY: 27,
    styles: { fontSize: 7.5, cellPadding: 1.8 },
    headStyles: { fillColor: TEAL, textColor: 255, fontStyle: "bold", halign: "center" },
    alternateRowStyles: { fillColor: [247, 250, 249] },
    columnStyles: {
      0: { cellWidth: 14, halign: "center", fontStyle: "bold", fillColor: TEAL_LIGHT },
      1: { cellWidth: 52 }, 2: { cellWidth: 10, halign: "center" },
      3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" },
      6: { halign: "right", fontStyle: "bold", textColor: TEAL },
      7: { halign: "right" }, 8: { halign: "center", cellWidth: 16 },
      9: { halign: "center", cellWidth: 14 },
    },
    margin: { left: 14, right: 14 },
    didParseCell(data) {
      if (data.section === "body" && data.column.index === 0 && data.cell.raw !== "")
        data.cell.styles.fillColor = TEAL_LIGHT;
    },
  });

  // ── Halaman 3+: Per Nama Hutan ─────────────────────────────
  doc.addPage();
  pageHeader(doc, "Per Nama Hutan");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Breakdown Per Nama Hutan per Tahun", 14, 24);

  const namaHead = [["Tahun", "Nama Hutan", "Jenis", "Area (ha)", "AGB (tC)", "BGB (tC)", "Total Carbon (tC)", "CO\u2082eq (tCO\u2082)", "\u0394", "% Total"]];
  const namaBody = [];
  const prevNamaC = {};
  for (const yr of years) {
    const d = carbonByYear[yr];
    const entries = Object.entries(d.byNama || {})
      .filter(([, nd]) => nd.totalCarbon > 0)
      .sort(([, a], [, b]) => b.totalCarbon - a.totalCarbon);
    entries.forEach(([key, nd], idx) => {
      const pct = d.totalCarbon > 0 ? (nd.totalCarbon / d.totalCarbon * 100).toFixed(1) : "0.0";
      let delta = "\u2013";
      if (prevNamaC[key] != null && prevNamaC[key] > 0) {
        const p = ((nd.totalCarbon - prevNamaC[key]) / prevNamaC[key] * 100).toFixed(1);
        delta = (nd.totalCarbon >= prevNamaC[key] ? "+" : "") + p + "%";
      }
      namaBody.push([idx === 0 ? yr : "", nd.nama, nd.kelas, N(nd.totalArea), N(nd.agb), N(nd.bgb), N(nd.totalCarbon), N(nd.totalCarbon * CO2_F), delta, pct + "%"]);
      prevNamaC[key] = nd.totalCarbon;
    });
  }
  doc.autoTable({
    head: namaHead, body: namaBody, startY: 27,
    styles: { fontSize: 7, cellPadding: 1.6 },
    headStyles: { fillColor: TEAL, textColor: 255, fontStyle: "bold", halign: "center" },
    alternateRowStyles: { fillColor: [247, 250, 249] },
    columnStyles: {
      0: { cellWidth: 14, halign: "center", fontStyle: "bold" },
      1: { cellWidth: 55 }, 2: { cellWidth: 24 },
      3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" },
      6: { halign: "right", fontStyle: "bold", textColor: TEAL },
      7: { halign: "right" }, 8: { halign: "center", cellWidth: 16 },
      9: { halign: "center", cellWidth: 14 },
    },
    margin: { left: 14, right: 14 },
    didParseCell(data) {
      if (data.section === "body" && data.column.index === 0 && data.cell.raw !== "")
        data.cell.styles.fillColor = TEAL_LIGHT;
    },
  });

  // ── Nomor halaman di setiap halaman ────────────────────────
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(160);
    doc.text("Tim Carbon \u2014 Kalkulator Stok Karbon", 14, 207);
    doc.text(`Halaman ${i} dari ${total}`, 283, 207, { align: "right" });
  }

  doc.save("tren-karbon-2015-2024.pdf");
}

// ── HELPER ───────────────────────────────────────────────────
function hexAlpha(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
