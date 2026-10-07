/* ============================================================
   Lumi — AI Skin & Glow-Up Coach
   Real client-side skin analysis (no server, no fake scores).
   ============================================================ */

// ---- monetization config (wire these to RevenueCat / Stripe) ----
const CONFIG = {
  brand: "Lumi",
  priceWeekly: "$6.99",
  trialDays: 3,
  // Paste your Stripe Payment Link here to take web payments. In Stripe, set the
  // link's success URL to:  https://YOUR-SITE/index.html?status=success
  stripeLink: "",
};

// ---------------- helpers ----------------
const $ = (id) => document.getElementById(id);
const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const views = [...document.querySelectorAll(".view")];
function show(id) {
  views.forEach((v) => v.classList.toggle("active", v.id === id));
  document.querySelector(".phone").scrollTop = 0;
  window.scrollTo(0, 0);
}
function showToast(msg, ms = 3400) {
  const t = $("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove("show"), ms);
}

// inject ring gradient once
(function injectGradient() {
  const svg = document.querySelector(".ring");
  if (!svg) return;
  const ns = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(ns, "defs");
  defs.innerHTML =
    '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#FF8FA3"/><stop offset=".5" stop-color="#FF6F91"/>' +
    '<stop offset="1" stop-color="#8B6CF0"/></linearGradient>';
  svg.prepend(defs);
})();

// ---------------- entitlement ----------------
const isPro = () => localStorage.getItem("lumi_pro") === "1";
const setPro = () => localStorage.setItem("lumi_pro", "1");

// Detect a return from Stripe checkout (success unlocks Pro; cancel is a graceful no-op).
const CHECKOUT = (() => {
  const p = new URLSearchParams(location.search);
  const s = p.get("status");
  if (s === "success" || p.get("paid") === "1") {
    setPro();
    history.replaceState({}, "", location.pathname);
    return "success";
  }
  if (s === "cancel") {
    history.replaceState({}, "", location.pathname);
    return "cancel";
  }
  return null;
})();

// ---------------- state ----------------
let lastImg = null; // HTMLImageElement
let lastMetrics = null;
let lastGlow = null;

// ============================================================
//  SKIN ANALYSIS ENGINE  — measures real pixels from the photo
// ============================================================
function analyze(img) {
  const W = 220;
  const H = Math.round((img.naturalHeight / img.naturalWidth) * W) || 220;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;

  // grayscale buffer for texture
  const gray = new Float32Array(W * H);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    gray[p] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  }

  // collect skin pixels via YCbCr skin model, sampled near center (face area)
  const lum = [], reds = [], skinIdx = [];
  let specular = 0;
  const cx = W / 2, cy = H * 0.46, rx = W * 0.42, ry = H * 0.42;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x - cx) / rx, ny = (y - cy) / ry;
      if (nx * nx + ny * ny > 1) continue; // elliptical face crop
      const idx = (y * W + x) * 4;
      const r = px[idx], g = px[idx + 1], b = px[idx + 2];
      const Y = 0.299 * r + 0.587 * g + 0.114 * b;
      const Cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const Cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      const isSkin = Cb >= 77 && Cb <= 127 && Cr >= 133 && Cr <= 173 && Y > 45;
      if (!isSkin) continue;
      lum.push(Y);
      reds.push(r - (g + b) / 2);
      skinIdx.push(y * W + x);
      if (Y > 232) specular++;
    }
  }

  if (lum.length < 250) return null; // not enough skin → ask for a clearer photo

  const n = lum.length;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const std = (a, m) => Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length);
  const meanLum = mean(lum), lumStd = std(lum, meanLum);
  const meanRed = mean(reds);
  const shineRatio = specular / n;

  // texture: average gradient magnitude over skin pixels
  let gsum = 0, gcount = 0;
  for (const p of skinIdx) {
    const x = p % W, y = (p / W) | 0;
    if (x < 1 || y < 1 || x > W - 2 || y > H - 2) continue;
    const gxv = gray[p + 1] - gray[p - 1];
    const gyv = gray[p + W] - gray[p - W];
    gsum += Math.sqrt(gxv * gxv + gyv * gyv);
    gcount++;
  }
  const texture = gcount ? gsum / gcount : 10;

  // dark spots: skin pixels notably darker than local mean
  let dark = 0;
  for (const L of lum) if (L < meanLum - 1.5 * lumStd) dark++;
  const darkRatio = dark / n;

  // ---- map raw signals -> 0-100 sub-scores (higher = better skin) ----
  const m = {
    radiance: clamp(46 + (meanLum - 95) * 0.5),
    evenness: clamp(104 - lumStd * 1.7),
    hydration: clamp(94 - Math.abs(shineRatio - 0.03) * 520 - Math.max(0, 120 - meanLum) * 0.18),
    smoothness: clamp(112 - texture * 4.6),
    calm: clamp(101 - Math.max(0, meanRed - 14) * 2.4),
    clarity: clamp(99 - darkRatio * 230),
  };
  for (const k in m) m[k] = Math.round(clamp(m[k], 34, 99));

  const glow = Math.round(
    m.radiance * 0.2 + m.evenness * 0.2 + m.smoothness * 0.2 +
    m.calm * 0.15 + m.hydration * 0.15 + m.clarity * 0.1
  );
  return { glow, metrics: m };
}

// ---------------- content libraries ----------------
const METRIC_META = {
  radiance:  { name: "Radiance",  note: "overall brightness & glow" },
  evenness:  { name: "Even tone", note: "uniformity of skin tone" },
  hydration: { name: "Hydration", note: "moisture & oil balance" },
  smoothness:{ name: "Smoothness",note: "texture & visible pores" },
  calm:      { name: "Calm",      note: "redness & sensitivity" },
  clarity:   { name: "Clarity",   note: "dark spots & marks" },
};

const CONCERN_LIB = {
  radiance:  { emoji: "🌫️", title: "Dullness", desc: "Skin is reading a little flat. Vitamin C + gentle exfoliation will bring the glow back.",
    am: [["Vitamin C serum", "Brightens and protects against dullness"]], pm: [["Gentle AHA 2×/week", "Lifts dead cells for instant radiance"]] },
  evenness:  { emoji: "🎨", title: "Uneven tone", desc: "Some patchiness in tone. Niacinamide and daily SPF even things out over weeks.",
    am: [["Niacinamide 5%", "Evens tone and calms blotchiness"]], pm: [] },
  hydration: { emoji: "💧", title: "Dehydration", desc: "Moisture balance is off. Lock in water with hyaluronic acid and a ceramide cream.",
    am: [["Hyaluronic acid", "Pulls water into the skin before moisturizer"]], pm: [["Ceramide moisturizer", "Repairs the barrier overnight"]] },
  smoothness:{ emoji: "🔬", title: "Texture & pores", desc: "Surface texture is visible. A retinoid at night smooths over time; BHA clears pores.",
    am: [], pm: [["Retinol (start 2×/week)", "Refines texture and minimizes pores"], ["BHA / salicylic 2×/week", "Clears congestion inside pores"]] },
  calm:      { emoji: "🌿", title: "Redness", desc: "Some redness detected. Soothing cica + a fragrance-free barrier cream settle it down.",
    am: [["Centella (cica) serum", "Soothes visible redness"]], pm: [["Fragrance-free barrier cream", "Reduces reactivity overnight"]] },
  clarity:   { emoji: "✨", title: "Dark spots", desc: "A few darker marks. Vitamin C + diligent SPF fade them; azelaic acid speeds it up.",
    am: [["Vitamin C + SPF", "Fades marks and prevents new ones"]], pm: [["Azelaic acid 10%", "Targets pigment and post-acne marks"]] },
};

const verdictFor = (s) =>
  s >= 85 ? "Glowing. Your skin is in great shape — let's protect and maintain it." :
  s >= 72 ? "Healthy base with clear room to glow. Your plan targets the gaps." :
  s >= 58 ? "Solid starting point. A focused routine will move this fast." :
            "Lots of upside here. Stay consistent for 4 weeks and watch it climb.";

// ---------------- renderers ----------------
function renderResults(res) {
  $("glow-score").textContent = res.glow;
  const ring = $("score-ring");
  const C = 2 * Math.PI * 52;
  ring.style.strokeDasharray = C;
  requestAnimationFrame(() => { ring.style.strokeDashoffset = C * (1 - res.glow / 100); });
  $("score-verdict").textContent = verdictFor(res.glow);

  const order = Object.keys(res.metrics).sort((a, b) => res.metrics[b] - res.metrics[a]);
  $("metrics").innerHTML = order.map((k) => {
    const v = res.metrics[k], meta = METRIC_META[k];
    return `<div class="metric">
      <div class="metric-top"><span class="metric-name">${meta.name}</span><span class="metric-val">${v}</span></div>
      <div class="metric-bar"><i style="width:${v}%"></i></div>
      <div class="metric-note">${meta.note}</div></div>`;
  }).join("");

  const concerns = order.slice(-3).reverse();
  $("concerns").innerHTML = concerns.map((k) => {
    const c = CONCERN_LIB[k];
    return `<div class="concern"><div class="emoji">${c.emoji}</div>
      <div><h4>${c.title}</h4><p>${c.desc}</p></div></div>`;
  }).join("");
  lastMetrics = res.metrics;
  lastGlow = res.glow;
  localStorage.setItem("lumi_last", JSON.stringify(res)); // survive a checkout redirect
}

function renderRoutine(metrics) {
  const order = Object.keys(metrics).sort((a, b) => metrics[a] - metrics[b]);
  const focus = order.slice(0, 3);
  $("routine-intro").textContent =
    "Built around your focus areas: " + focus.map((k) => CONCERN_LIB[k].title.toLowerCase()).join(", ") + ".";

  const am = [["Gentle cleanser", "Wash with lukewarm water to start fresh"]];
  const pm = [["Gentle cleanser", "Remove the day — double cleanse if you wore SPF/makeup"]];
  focus.forEach((k) => { CONCERN_LIB[k].am.forEach((s) => am.push(s)); CONCERN_LIB[k].pm.forEach((s) => pm.push(s)); });
  am.push(["Moisturizer", "Seal everything in"], ["SPF 30+ (every morning)", "The single biggest anti-aging + anti-spot step"]);
  pm.push(["Moisturizer / night cream", "Support overnight repair"]);

  const dedupe = (arr) => { const seen = new Set(); return arr.filter(([t]) => !seen.has(t) && seen.add(t)); };
  const block = (title, icon, steps) =>
    `<div class="routine-block"><h3>${icon} ${title}</h3>` +
    dedupe(steps).map(([t, d], i) => `<div class="step"><div class="step-num">${i + 1}</div><div><b>${t}</b><span>${d}</span></div></div>`).join("") +
    `</div>`;
  $("routine-content").innerHTML = block("Morning", "🌅", am) + block("Evening", "🌙", pm);
}

// ---------------- progress ----------------
const loadScans = () => JSON.parse(localStorage.getItem("lumi_scans") || "[]");
function saveScan(score) {
  const scans = loadScans();
  const today = new Date().toISOString().slice(0, 10);
  scans.push({ d: today, s: score });
  localStorage.setItem("lumi_scans", JSON.stringify(scans.slice(-30)));
}
function renderProgress() {
  const scans = loadScans();
  $("streak").textContent = `🔥 ${scans.length} scan${scans.length === 1 ? "" : "s"} logged · keep your streak going`;
  const recent = scans.slice(-6);
  const max = 100;
  $("progress-chart").innerHTML = recent.map((p) =>
    `<div class="col"><span class="v">${p.s}</span><i style="height:${(p.s / max) * 100}%"></i></div>`).join("");
  $("chart-x").innerHTML = recent.map((p) => `<span>${p.d.slice(5)}</span>`).join("");

  let html = "";
  if (scans.length >= 2) {
    const delta = scans[scans.length - 1].s - scans[scans.length - 2].s;
    const cls = delta >= 0 ? "up" : "down";
    const sign = delta >= 0 ? "+" : "";
    html += `<div class="delta"><span>Since your last scan</span><b class="${cls}">${sign}${delta} pts</b></div>`;
    const first = scans[0].s, now = scans[scans.length - 1].s;
    html += `<div class="delta"><span>Total glow-up</span><b class="${now - first >= 0 ? "up" : "down"}">${now - first >= 0 ? "+" : ""}${now - first} pts</b></div>`;
  } else {
    html = `<div class="delta"><span>First scan logged 🎉</span><b>${scans[0]?.s ?? "–"}</b></div>
            <div class="delta"><span>Scan again tomorrow to track change</span><b>→</b></div>`;
  }
  $("progress-content").innerHTML = html;
}

// ============================================================
//  FLOW / EVENTS
// ============================================================
$("price-weekly").textContent = CONFIG.priceWeekly;

document.querySelectorAll("[data-back]").forEach((b) =>
  b.addEventListener("click", () => show(b.dataset.back)));

$("btn-start").addEventListener("click", () => show(isPro() && loadScans().length ? "view-progress" : "view-capture"));
if (isPro() && loadScans().length) renderProgress();

// file pick
$("file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    lastImg = img;
    $("preview").src = url; $("preview").hidden = false;
    $("capture-placeholder").style.display = "none";
    $("btn-analyze").disabled = false;
    $("scan-img").src = url;
  };
  img.src = url;
});

// analyze
$("btn-analyze").addEventListener("click", () => {
  if (!lastImg) return;
  show("view-analyzing");
  const steps = ["Detecting facial skin region", "Measuring radiance & tone", "Scanning texture & pores", "Checking redness & hydration", "Building your Glow Score"];
  const ul = $("analyze-steps");
  ul.innerHTML = steps.map((s) => `<li><span class="dot"></span>${s}</li>`).join("");
  const items = [...ul.children];
  $("analyze-bar").style.width = "0";

  let i = 0;
  const tick = setInterval(() => {
    if (i < items.length) {
      items[i].classList.add("done");
      items[i].querySelector(".dot").textContent = "✓";
      $("analyze-bar").style.width = `${((i + 1) / items.length) * 100}%`;
      i++;
    } else {
      clearInterval(tick);
      const res = analyze(lastImg);
      if (!res) {
        alert("Hmm — I couldn't get a clear read on your skin. Try a brighter, front-facing photo that fills the frame.");
        show("view-capture");
        return;
      }
      renderResults(res);
      show("view-results");
    }
  }, 520);
});

// results -> routine (gated)
$("btn-get-routine").addEventListener("click", () => {
  if (isPro()) { renderRoutine(lastMetrics); show("view-routine"); }
  else show("view-paywall");
});

// paywall actions
function unlock() {
  setPro();
  renderRoutine(lastMetrics || { radiance: 70, evenness: 70, hydration: 70, smoothness: 70, calm: 70, clarity: 70 });
  show("view-routine");
}
$("btn-trial").addEventListener("click", () => {
  if (CONFIG.stripeLink) { location.href = CONFIG.stripeLink; return; } // real checkout
  unlock(); // demo: simulate successful trial start
});
$("btn-restore").addEventListener("click", () => { if (isPro()) unlock(); else alert("No previous purchase found on this device."); });
$("btn-demo-unlock").addEventListener("click", unlock);

// routine -> progress
$("btn-track").addEventListener("click", () => {
  saveScan(lastGlow ?? 70);
  renderProgress();
  show("view-progress");
});

$("btn-rescan").addEventListener("click", () => {
  $("preview").hidden = true; $("capture-placeholder").style.display = "grid";
  $("btn-analyze").disabled = true; lastImg = null; $("file-input").value = "";
  show("view-capture");
});
$("btn-reset").addEventListener("click", () => {
  if (confirm("Clear all scan history?")) { localStorage.removeItem("lumi_scans"); renderProgress(); }
});

// Handle the return from Stripe checkout.
if (CHECKOUT === "success") {
  const last = JSON.parse(localStorage.getItem("lumi_last") || "null");
  if (last && last.metrics) {
    lastMetrics = last.metrics; lastGlow = last.glow;
    renderRoutine(last.metrics);
    show("view-routine");
  }
  showToast("✨ Welcome to Lumi Pro — your full routine is unlocked");
} else if (CHECKOUT === "cancel") {
  showToast("No charge made. Your free scan is still here whenever you're ready.");
}
