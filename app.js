/* Today's menu board — Telegram Mini App (no build step, works on GitHub Pages).
   Data: config.json (restaurant info) + a CSV (Google Sheet, or the local menu.csv demo). */
(() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  const inTelegram = !!(tg && tg.platform && tg.platform !== "unknown");
  const params = new URLSearchParams(location.search);

  const T = {
    ru: { left: "осталось", portions: "порц.", soldOut: "Закончилось", available: "Есть",
      updated: "Обновлено", today: "Сегодня", loadErr: "Не удалось загрузить меню. Потяните вниз или попробуйте позже.",
      empty: "Меню на сегодня пока не опубликовано.", lunchTime: "обед", call: "Позвонить" },
    en: { left: "left", portions: "", soldOut: "Sold out", available: "Available",
      updated: "Updated", today: "Today", loadErr: "Couldn't load the menu. Please try again in a moment.",
      empty: "Today's menu isn't published yet.", lunchTime: "lunch", call: "Call" },
  };
  const userLang = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.language_code) || navigator.language || "ru";
  const state = {
    lang: params.get("lang") || (/^(ru|be|uk|kk)/i.test(userLang) ? "ru" : "en"),
    cfg: null, items: [], updatedAt: null, error: false,
  };
  if (!T[state.lang]) state.lang = "ru";

  const $ = (s) => document.querySelector(s);
  const t = (k) => T[state.lang][k];
  const L = (o) => (o && typeof o === "object" ? (o[state.lang] || o.ru || o.en || "") : (o || ""));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const yes = (v, dflt) => { v = String(v ?? "").trim().toLowerCase(); return v === "" ? dflt : ["yes", "y", "да", "д", "true", "1", "+", "x", "✓", "✅"].includes(v); };
  const num = (v) => { v = String(v ?? "").trim().replace(",", "."); return v === "" || isNaN(+v) ? null : +v; };
  // "Супы / Soups" -> ru: "Супы", en: "Soups"
  const pickLang = (s) => { const p = String(s || "").split(" / "); return p.length > 1 ? (state.lang === "en" ? p[1] : p[0]).trim() : String(s || "").trim(); };
  const slug = (s) => "c-" + String(s).toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-");

  // ---------- CSV (handles quotes, commas and newlines inside quotes) ----------
  function parseCSV(text) {
    const rows = []; let row = [], f = "", q = false;
    text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
        else if (c === '"') q = false;
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(f); rows.push(row); row = []; f = "";
      } else f += c;
    }
    if (f !== "" || row.length) { row.push(f); rows.push(row); }
    const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
    return rows.filter((r) => r.some((c) => c.trim() !== ""))
      .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
  }

  function toItems(rows) {
    return rows.map((r) => ({
      category: r.category || "",
      emoji: r.emoji || "🍽️",
      name: { ru: r.name_ru || r.name_en || r.name || "", en: r.name_en || r.name_ru || r.name || "" },
      desc: { ru: r.desc_ru || r.desc_en || "", en: r.desc_en || r.desc_ru || "" },
      price: num(r.price) ?? (r.price || null),   // "10 / 12 / 15" (portion sizes) is kept as text
      qty: num(r.qty),                       // blank = not counted
      lunch: yes(r.lunch, false),
      available: yes(r.available, true),     // blank = available
      image: r.image || "",
    })).filter((i) => i.available && (i.name.ru || i.name.en));
  }

  // ---------- rendering ----------
  const money = (p) => p == null ? "" : (typeof p === "string" ? p : Number.isInteger(p) ? p : p.toFixed(2)) + " " + (state.cfg.currency || "");

  function badge(it) {
    if (it.qty === null) return `<div class="badge free">${t("available")}</div>`;
    if (it.qty <= 0) return `<div class="badge out">${t("soldOut")}</div>`;
    const low = it.qty <= (state.cfg.low_stock ?? 3);
    return `<div class="badge ${low ? "low" : "ok"}"><b>${it.qty}</b>${t("left")}${t("portions") ? " " + t("portions") : ""}</div>`;
  }

  function row(it) {
    const pic = it.image ? `<img src="${esc(it.image)}" alt="" loading="lazy">` : esc(it.emoji);
    const out = it.qty !== null && it.qty <= 0;
    return `<div class="item ${out ? "out" : ""}">
      <div class="pic">${pic}</div>
      <div class="info"><b>${esc(L(it.name))}</b>${L(it.desc) ? `<small>${esc(L(it.desc))}</small>` : ""}
        <span class="price">${esc(money(it.price))}</span></div>
      ${badge(it)}
    </div>`;
  }

  // in-stock first, sold-out last, otherwise keep sheet order
  const sortStock = (arr) => arr.map((x, i) => [x, i])
    .sort((a, b) => ((a[0].qty === 0) - (b[0].qty === 0)) || a[1] - b[1]).map((x) => x[0]);

  function render() {
    const c = state.cfg;
    document.documentElement.lang = state.lang;
    document.title = L(c.name);
    $("#r-name").textContent = L(c.name);
    $("#r-tagline").textContent = L(c.tagline);
    $("#lang-btn").textContent = state.lang === "ru" ? "EN" : "RU";
    const d = new Date().toLocaleDateString(state.lang === "ru" ? "ru-RU" : "en-GB", { weekday: "long", day: "numeric", month: "long" });
    $("#today").textContent = d.charAt(0).toUpperCase() + d.slice(1);
    $("#updated").textContent = state.updatedAt
      ? `${t("updated")} ${state.updatedAt.toLocaleTimeString(state.lang === "ru" ? "ru-RU" : "en-GB", { hour: "2-digit", minute: "2-digit" })}` : "";

    const phone = c.phone ? ` · <a href="tel:${esc(c.phone.replace(/[^\d+]/g, ""))}">${esc(c.phone)}</a>` : "";
    $("#foot").innerHTML = `${esc(L(c.address))}${c.hours ? " · " + esc(c.hours) : ""}${phone}`;

    if (state.error && !state.items.length) { $("#cats").innerHTML = ""; $("#content").innerHTML = `<p class="error">${t("loadErr")}</p>`; return; }
    if (!state.items.length) { $("#cats").innerHTML = ""; $("#content").innerHTML = `<p class="empty muted">${t("empty")}</p>`; return; }

    const sections = [];
    const lunch = state.items.filter((i) => i.lunch);
    if (lunch.length) {
      const title = L(c.lunch && c.lunch.title) || "Lunch";
      sections.push({ id: "c-lunch", label: "⭐ " + title, sub: c.lunch && c.lunch.time ? `${t("lunchTime")} ${c.lunch.time}` : "", items: lunch, lunch: true });
    }
    const cats = [];
    for (const it of state.items) if (!it.lunch && !cats.includes(it.category)) cats.push(it.category);
    for (const cat of cats) {
      const items = state.items.filter((i) => !i.lunch && i.category === cat);
      sections.push({ id: slug(cat || "other"), label: `${items[0].emoji} ${pickLang(cat) || "—"}`, items });
    }

    const active = ($("#cats .active") || {}).dataset?.target;
    $("#cats").innerHTML = sections.length > 1 ? sections.map((s, i) =>
      `<button data-target="${s.id}" class="${(active ? active === s.id : i === 0) ? "active" : ""}">${esc(s.label)}</button>`).join("") : "";
    $("#content").innerHTML = sections.map((s) => {
      const head = `<h2 class="section-title" id="${s.id}"><span>${esc(s.label)}</span>${s.sub ? `<small>${esc(s.sub)}</small>` : ""}</h2>`;
      const body = sortStock(s.items).map(row).join("");
      return head + (s.lunch ? `<div class="lunch-box">${body}</div>` : body);
    }).join("");
  }

  // ---------- data ----------
  async function load() {
    try {
      const src = state.cfg.sheet_csv_url || "menu.csv";
      const url = src + (src.includes("?") ? "&" : "?") + "_=" + Date.now();
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      state.items = toItems(parseCSV(await res.text()));
      state.updatedAt = new Date(); state.error = false;
    } catch (e) {
      console.error("menu load failed", e);
      state.error = true;
    }
    render();
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.id === "lang-btn") { state.lang = state.lang === "ru" ? "en" : "ru"; render(); }
    else if (b.dataset.target) {
      document.querySelectorAll("#cats button").forEach((x) => x.classList.toggle("active", x === b));
      document.getElementById(b.dataset.target).scrollIntoView({ behavior: "smooth", block: "start" });
      try { tg && tg.HapticFeedback.selectionChanged(); } catch (_) {}
    }
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.cfg) load(); });

  // ---------- boot ----------
  if (inTelegram) { tg.ready(); tg.expand(); try { tg.setHeaderColor("bg_color"); } catch (_) {} }
  fetch("config.json?_=" + Date.now(), { cache: "no-store" })
    .then((r) => r.json())
    .then((cfg) => {
      state.cfg = cfg;
      load();
      setInterval(() => { if (!document.hidden) load(); }, Math.max(20, cfg.refresh_seconds || 60) * 1000);
    })
    .catch(() => { $("#r-name").textContent = "⚠️"; $("#content").innerHTML = `<p class="error">${t("loadErr")}</p>`; });
})();
