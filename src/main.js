import "@fontsource/fraunces/500.css";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import "./style.css";
import { Capacitor } from "@capacitor/core";
import { createGlobe } from "./globe.js";
import { PLACES, CATEGORIES } from "./places.js";
import {
  subsolarPoint,
  sunAltitude,
  distanceKm,
  quizPoints,
  flightMinutes,
  formatKm,
  formatDuration,
  formatCoord,
  localTime,
  daylightLabel,
} from "./geo.js";

const $ = (sel) => document.querySelector(sel);
const native = Capacitor.isNativePlatform();

// ---------- pamięć urządzenia ----------

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("meridian-" + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("meridian-" + key, JSON.stringify(value));
    } catch {
      /* tryb prywatny — działamy bez zapisu */
    }
  },
};

const settings = { real: true, clouds: true, spin: true, ...store.get("settings", {}) };
const favorites = new Set(store.get("favorites", []));
let own = store.get("own", []).filter((p) => p && p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng));
let home = store.get("home", null);
const best = store.get("best", {});

const allPlaces = () => PLACES.concat(own.map((p) => ({ ...p, cat: "own", region: "Moje miejsce", tz: null, blurb: "" })));
const byId = (id) => allPlaces().find((p) => p.id === id);

// ---------- ikony ----------

const svg = (path) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const ICON = {
  tour: svg('<path d="M3 11l18-8-8 18-2-8-8-2z"/>'),
  quiz: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><path d="M12 17h.01"/>'),
  settings: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  star: svg('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
};
$("#btn-tour").innerHTML = ICON.tour;
$("#btn-quiz").innerHTML = ICON.quiz;
$("#btn-settings").innerHTML = ICON.settings;
$("#version").textContent = "wersja " + __APP_VERSION__;

// ---------- globus ----------

let selection = null; // { type: "place", id } albo { type: "point", lat, lng }
let mode = "places";

const globe = createGlobe($("#view"), {
  onPlace: (id) => {
    if (mode === "places") selectPlace(id, { scroll: true });
  },
  onGround: (pt) => {
    if (mode === "quiz") quizAnswer(pt);
    else if (mode === "places") selectPoint(pt);
  },
});
globe.whenReady(() => $("#loading").classList.add("done"));

// ---------- czas i słońce ----------

let offsetH = 0;
const now = () => new Date(Date.now() + offsetH * 3600000);
const clockFmt = new Intl.DateTimeFormat("pl-PL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function applySun() {
  globe.setSun(settings.real);
  const s = subsolarPoint(now());
  globe.setSubsolar(s.lat, s.lng);
  const shift = offsetH ? ` <b>${offsetH > 0 ? "+" : "−"}${formatHours(Math.abs(offsetH))}</b>` : "";
  $("#clock").innerHTML = settings.real ? clockFmt.format(now()) + shift : "Zawsze dzień";
}

function formatHours(h) {
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  return min ? `${whole} h ${min} min` : `${whole} h`;
}

function tick() {
  applySun();
  if (mode === "places") {
    renderList();
    renderDetail();
  }
}
setInterval(tick, 30000);

// ---------- lista i wyszukiwanie ----------

let filter = store.get("filter", "all");
let query = "";

const fold = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/g, "l");

function filtered() {
  const q = fold(query.trim());
  return allPlaces().filter((p) => {
    if (filter === "fav" && !favorites.has(p.id)) return false;
    if (filter !== "all" && filter !== "fav" && p.cat !== filter) return false;
    return !q || fold(p.name + " " + p.region).includes(q);
  });
}

function renderChips() {
  const places = allPlaces();
  const count = (id) => (id === "all" ? places.length : id === "fav" ? places.filter((p) => favorites.has(p.id)).length : places.filter((p) => p.cat === id).length);
  $("#chips").innerHTML = "";
  for (const c of CATEGORIES) {
    const n = count(c.id);
    if (!n && (c.id === "fav" || c.id === "own") && filter !== c.id) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip" + (filter === c.id ? " on" : "");
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(filter === c.id));
    b.innerHTML = `${c.label}<small>${n}</small>`;
    b.onclick = () => {
      filter = c.id;
      store.set("filter", filter);
      renderChips();
      renderList();
    };
    $("#chips").appendChild(b);
  }
}

function sunClass(alt) {
  return alt > 0 ? "" : alt > -6 ? "dusk" : "night";
}

function renderList() {
  const list = $("#list");
  const items = filtered();
  const date = now();
  list.innerHTML = "";
  if (!items.length) {
    list.innerHTML = `<li class="empty">${filter === "fav" ? "Nie masz jeszcze ulubionych. Otwórz miejsce i dotknij gwiazdki." : filter === "own" ? "Dotknij globusu w dowolnym punkcie, żeby dodać własne miejsce." : "Nic nie pasuje do wyszukiwania."}</li>`;
    return;
  }
  for (const p of items) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.id = p.id;
    const on = selection?.type === "place" && selection.id === p.id;
    b.className = on ? "on" : "";
    const alt = sunAltitude(p.lat, p.lng, date);
    b.innerHTML = `<i class="mark${p.cat === "own" ? " own" : ""}"></i><span class="copy"><strong></strong><span class="sub"></span></span><span class="time"><i class="sun-dot ${sunClass(alt)}"></i>${localTime(date, p.tz, p.lng)}</span>`;
    b.querySelector("strong").textContent = p.name;
    b.querySelector(".sub").textContent = p.region;
    b.onclick = () => {
      stopTour();
      selectPlace(p.id);
    };
    li.appendChild(b);
    list.appendChild(li);
  }
}

$("#q").addEventListener("input", (e) => {
  query = e.target.value;
  renderList();
});
$("#q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const first = filtered()[0];
    if (first) selectPlace(first.id);
    e.target.blur();
  }
});

// ---------- zaznaczenie i karta ----------

function selectPlace(id, { scroll = false, fly = true } = {}) {
  const p = byId(id);
  if (!p) return;
  if (selection?.type === "place" && selection.id === id && !tour) {
    clearSelection();
    return;
  }
  selection = { type: "place", id };
  globe.setPin("tap", null);
  globe.select(id, { fly });
  drawHomeArc(p);
  renderDetail();
  renderList();
  if (scroll) $(`#list button[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function selectPoint(pt) {
  stopTour();
  selection = { type: "point", lat: pt.lat, lng: pt.lng };
  globe.select(null, { fly: false });
  globe.setPin("tap", pt, 0x8fd3ff);
  drawHomeArc(pt);
  renderDetail();
  renderList();
  if (sheetState() === "mini") setSheet("peek");
}

function clearSelection() {
  selection = null;
  globe.select(null, { fly: false });
  globe.setPin("tap", null);
  globe.setArc(null);
  globe.release();
  renderDetail();
  renderList();
}

function drawHomeArc(target) {
  if (home && target && distanceKm(home.lat, home.lng, target.lat, target.lng) > 30) globe.setArc(home, target);
  else globe.setArc(null);
}

function factsHtml(lat, lng, tz, withCoord = true) {
  const date = now();
  const alt = sunAltitude(lat, lng, date);
  const time = localTime(date, tz, lng);
  const rows = [
    `<span>${tz ? "Czas lokalny" : "Czas słoneczny (przybliżony)"}: <b>${time}</b></span>`,
    `<span>Teraz: <b>${daylightLabel(alt)}</b></span>`,
  ];
  if (home) {
    const km = distanceKm(home.lat, home.lng, lat, lng);
    if (km > 30) rows.push(`<span class="km">Od mojego punktu: <b>${formatKm(km)}</b> · lot ok. ${formatDuration(flightMinutes(km))}</span>`);
    else rows.push(`<span class="km">To jest <b>tuż obok</b> twojego punktu</span>`);
  }
  if (withCoord) rows.push(`<span>${formatCoord(lat, lng)}</span>`);
  return `<div class="facts">${rows.join("")}</div>`;
}

function renderDetail() {
  const el = $("#detail");
  if (!selection) {
    el.innerHTML = `<p class="hint">Przeciągnij globus, szczypnij albo przewiń, żeby przybliżyć. Dotknij świecącego znacznika lub miejsca z listy — kamera tam doleci. Dotknij dowolnego punktu Ziemi, żeby sprawdzić, która tam godzina.</p>`;
    return;
  }
  if (selection.type === "place") {
    const p = byId(selection.id);
    if (!p) return clearSelection();
    const fav = favorites.has(p.id);
    el.innerHTML = `<div class="card">
      <div class="card-head"><div><p class="region"></p><h2></h2></div>
      <button class="star${fav ? " on" : ""}" type="button" aria-pressed="${fav}" aria-label="${fav ? "Usuń z ulubionych" : "Dodaj do ulubionych"}">${ICON.star}</button></div>
      ${p.blurb ? '<p class="blurb"></p>' : ""}
      ${factsHtml(p.lat, p.lng, p.tz)}
      <div class="card-actions">
        <button class="ghost small" data-act="close" type="button">Zamknij</button>
        <button class="ghost small" data-act="home" type="button">Ustaw jako mój punkt</button>
        ${p.cat === "own" ? '<button class="ghost small danger" data-act="delete" type="button">Usuń miejsce</button>' : ""}
      </div></div>`;
    el.querySelector(".region").textContent = p.region;
    el.querySelector("h2").textContent = p.name;
    if (p.blurb) el.querySelector(".blurb").textContent = p.blurb;
    el.querySelector(".star").onclick = () => {
      if (favorites.has(p.id)) favorites.delete(p.id);
      else favorites.add(p.id);
      store.set("favorites", [...favorites]);
      renderDetail();
      renderChips();
    };
    el.querySelector('[data-act="close"]').onclick = clearSelection;
    el.querySelector('[data-act="home"]').onclick = () => setHome({ lat: p.lat, lng: p.lng, label: p.name });
    el.querySelector('[data-act="delete"]')?.addEventListener("click", () => {
      own = own.filter((o) => o.id !== p.id);
      favorites.delete(p.id);
      store.set("own", own);
      store.set("favorites", [...favorites]);
      globe.setPlaces(allPlaces());
      clearSelection();
      renderChips();
      toast(`Usunięto „${p.name}”.`);
    });
    return;
  }
  const { lat, lng } = selection;
  el.innerHTML = `<div class="card">
    <p class="region">Wybrany punkt</p><h2>${formatCoord(lat, lng).replace(/\s{3}/, ", ")}</h2>
    ${factsHtml(lat, lng, null, false)}
    <form class="name-form" hidden><input type="text" maxlength="40" placeholder="Nazwa miejsca" aria-label="Nazwa miejsca" required /><button class="solid" type="submit">Zapisz</button></form>
    <div class="card-actions">
      <button class="ghost small" data-act="close" type="button">Zamknij</button>
      <button class="ghost small" data-act="add" type="button">Dodaj do moich miejsc</button>
      <button class="ghost small" data-act="home" type="button">Ustaw jako mój punkt</button>
    </div></div>`;
  const form = el.querySelector(".name-form");
  el.querySelector('[data-act="close"]').onclick = clearSelection;
  el.querySelector('[data-act="home"]').onclick = () => setHome({ lat, lng, label: null });
  el.querySelector('[data-act="add"]').onclick = (e) => {
    form.hidden = false;
    e.currentTarget.hidden = true;
    form.querySelector("input").focus();
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    const name = form.querySelector("input").value.trim();
    if (!name) return;
    const place = { id: "own-" + Date.now().toString(36), name, lat: +lat.toFixed(4), lng: +lng.toFixed(4) };
    own.push(place);
    store.set("own", own);
    globe.setPlaces(allPlaces());
    renderChips();
    selectPlace(place.id, { fly: false });
    toast(`Dodano „${name}” do moich miejsc.`);
  };
}

// ---------- mój punkt ----------

function setHome(pt) {
  // zaokrąglenie do ok. 1 km — dokładniej nie trzeba, a mniej zostaje w pamięci
  home = pt ? { lat: Math.round(pt.lat * 100) / 100, lng: Math.round(pt.lng * 100) / 100, label: pt.label || null } : null;
  store.set("home", home);
  globe.setPin("home", home, 0x9fe0c0);
  renderHomeInfo();
  if (selection?.type === "place") drawHomeArc(byId(selection.id));
  else if (selection?.type === "point") drawHomeArc(selection);
  renderDetail();
  if (pt) toast("Zapisano twój punkt — przy każdym miejscu zobaczysz odległość.");
}

function renderHomeInfo() {
  $("#home-info").textContent = home ? `${home.label ? home.label + " · " : ""}${formatCoord(home.lat, home.lng)}` : "Nie ustawiono. Z mojego punktu liczę odległości i rysuję trasę lotu.";
  $("#home-clear").hidden = !home;
}

$("#home-clear").onclick = () => {
  setHome(null);
  toast("Usunięto twój punkt.");
};
$("#home-gps").onclick = () => {
  if (!navigator.geolocation) return toast("To urządzenie nie udostępnia lokalizacji.");
  $("#home-gps").disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $("#home-gps").disabled = false;
      setHome({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: "Moja lokalizacja" });
      globe.focus(home.lat, home.lng);
    },
    () => {
      $("#home-gps").disabled = false;
      toast("Nie udało się pobrać lokalizacji. Możesz dotknąć globusu i ustawić punkt ręcznie.");
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
  );
};

// ---------- ustawienia ----------

const optReal = $("#opt-real");
const optClouds = $("#opt-clouds");
const optSpin = $("#opt-spin");
const optTime = $("#opt-time");
optReal.checked = settings.real;
optClouds.checked = settings.clouds;
optSpin.checked = settings.spin;

function saveSettings() {
  store.set("settings", settings);
}
optReal.onchange = () => {
  settings.real = optReal.checked;
  $("#time-box").hidden = !settings.real;
  saveSettings();
  applySun();
};
optClouds.onchange = () => {
  settings.clouds = optClouds.checked;
  globe.setClouds(settings.clouds);
  saveSettings();
};
optSpin.onchange = () => {
  settings.spin = optSpin.checked;
  globe.setSpin(settings.spin);
  saveSettings();
};
function setOffset(h) {
  offsetH = h;
  optTime.value = String(h);
  $("#time-out").textContent = h ? (h > 0 ? "+" : "−") + formatHours(Math.abs(h)) : "teraz";
  $("#time-now").hidden = !h;
  applySun();
}
optTime.oninput = () => setOffset(Number(optTime.value));
$("#time-now").onclick = () => setOffset(0);

// ---------- panel: widoki i arkusz na telefonie ----------

const panel = $("#panel");
const isDesktop = () => matchMedia("(min-width: 820px)").matches;
const sheetState = () => panel.dataset.sheet;

function setSheet(state) {
  panel.dataset.sheet = state;
}

function showView(name) {
  mode = name;
  for (const v of ["places", "quiz", "settings"]) $(`#view-${v}`).hidden = v !== name;
  $("#btn-quiz").classList.toggle("on", name === "quiz");
  $("#btn-settings").classList.toggle("on", name === "settings");
  $("#btn-quiz").innerHTML = name === "quiz" ? ICON.close : ICON.quiz;
  $("#btn-settings").innerHTML = name === "settings" ? ICON.close : ICON.settings;
  if (name === "places") {
    renderList();
    renderDetail();
  }
}

$("#btn-settings").onclick = () => {
  stopTour();
  if (mode === "quiz") endQuiz();
  showView(mode === "settings" ? "places" : "settings");
  if (mode === "settings" && sheetState() !== "full" && !isDesktop()) setSheet("full");
};

// przeciąganie uchwytu: w górę — większy, w dół — mniejszy, dotknięcie — przełącz
{
  const grip = $("#grip");
  let y0 = null;
  grip.addEventListener("pointerdown", (e) => {
    y0 = e.clientY;
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener("pointerup", (e) => {
    if (y0 == null) return;
    const dy = e.clientY - y0;
    y0 = null;
    const order = ["mini", "peek", "full"];
    const i = order.indexOf(sheetState());
    if (dy < -24) setSheet(order[Math.min(2, i + 1)]);
    else if (dy > 24) setSheet(order[Math.max(0, i - 1)]);
    else setSheet(sheetState() === "full" ? "peek" : "full");
  });
}

// globus przesuwa się tak, żeby jego środek był w wolnej części ekranu
new ResizeObserver(() => {
  if (isDesktop()) globe.setViewShift((panel.offsetWidth + 16) / 2, 0);
  else globe.setViewShift(0, Math.min(panel.offsetHeight, window.innerHeight * 0.6) / 2);
}).observe(panel);

// ---------- wycieczka ----------

let tour = null;
function startTour() {
  const list = filtered();
  if (list.length < 2) return toast("Za mało miejsc na liście, żeby ruszyć w wycieczkę.");
  if (mode !== "places") showView("places");
  let i = selection?.type === "place" ? list.findIndex((p) => p.id === selection.id) : -1;
  const step = () => {
    i = (i + 1) % list.length;
    selectPlace(list[i].id, { scroll: true });
  };
  tour = setInterval(step, 7000);
  step();
  $("#btn-tour").classList.add("on");
  $("#btn-tour").innerHTML = ICON.stop;
  $("#btn-tour").setAttribute("aria-label", "Zatrzymaj wycieczkę");
  toast(`Wycieczka po ${list.length} miejscach. Dotknij globusu, żeby przerwać.`);
}
function stopTour() {
  if (!tour) return;
  clearInterval(tour);
  tour = null;
  $("#btn-tour").classList.remove("on");
  $("#btn-tour").innerHTML = ICON.tour;
  $("#btn-tour").setAttribute("aria-label", "Wycieczka po miejscach");
}
$("#btn-tour").onclick = () => (tour ? stopTour() : startTour());
$("#view canvas").addEventListener("pointerdown", stopTour);

// ---------- quiz ----------

const LEVELS = [
  { id: "easy", label: "Łatwy", desc: "Miasta świata, z podpowiedzią kraju", pool: () => PLACES.filter((p) => p.cat === "m"), hint: true },
  { id: "world", label: "Cały świat", desc: "Miasta, cuda i przyroda — bez podpowiedzi", pool: () => PLACES, hint: false },
  { id: "pl", label: "Polska", desc: "Miejsca w Polsce — tu liczy się każdy kilometr", pool: () => PLACES.filter((p) => p.cat === "p"), hint: false, scale: 8 },
];
const ROUNDS = 10;
let quiz = null;

function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

$("#btn-quiz").onclick = () => {
  stopTour();
  if (mode === "quiz") {
    endQuiz();
    showView("places");
    return;
  }
  clearSelection();
  showView("quiz");
  globe.setMarkersVisible(false);
  globe.setPin("home", null);
  renderQuizStart();
};

function renderQuizStart() {
  quiz = null;
  const el = $("#view-quiz");
  el.innerHTML = `<h2 class="section-title">Gdzie to jest?</h2>
    <p class="hint">Dostajesz nazwę miejsca i dotykasz globusu tam, gdzie twoim zdaniem leży. Im bliżej, tym więcej punktów — maksymalnie 1000 za rundę, ${ROUNDS} rund.</p>
    <div class="levels"></div>`;
  for (const lv of LEVELS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "level";
    b.innerHTML = `<strong>${lv.label}</strong><small>${lv.desc}${best[lv.id] ? ` · rekord ${best[lv.id]}` : ""}</small>`;
    b.onclick = () => startQuiz(lv);
    el.querySelector(".levels").appendChild(b);
  }
  if (!isDesktop()) setSheet("peek");
}

function startQuiz(level) {
  quiz = { level, list: shuffle(level.pool()).slice(0, ROUNDS), round: 0, score: 0, answered: false };
  renderRound();
}

function renderRound() {
  const q = quiz;
  const p = q.list[q.round];
  q.answered = false;
  globe.setPin("guess", null);
  globe.setPin("target", null);
  globe.setArc(null);
  globe.release();
  $("#view-quiz").innerHTML = `
    <div class="quiz-meta"><span>Runda <b>${q.round + 1}</b> z ${q.list.length}</span><span>Wynik <b>${q.score}</b></span></div>
    <div class="progress"><i style="width:${(q.round / q.list.length) * 100}%"></i></div>
    <p class="hint">Gdzie leży…</p>
    <p class="quiz-target"></p>
    ${q.level.hint ? '<p class="region quiz-hint"></p>' : ""}
    <p class="hint">Obróć globus i dotknij miejsca, które obstawiasz.</p>`;
  $("#view-quiz .quiz-target").textContent = p.name;
  if (q.level.hint) $("#view-quiz .quiz-hint").textContent = p.region;
  if (!isDesktop()) setSheet("mini");
}

function quizAnswer(pt) {
  const q = quiz;
  if (!q || q.answered) return;
  q.answered = true;
  const p = q.list[q.round];
  const km = distanceKm(pt.lat, pt.lng, p.lat, p.lng);
  const pts = quizPoints(km * (q.level.scale || 1));
  q.score += pts;
  globe.setPin("guess", pt, 0x8fd3ff);
  globe.setPin("target", p, 0xffd48a);
  globe.setArc(pt, p);
  // kamera na środek odcinka, oddalona tak, żeby objąć oba punkty
  const mid = { lat: (pt.lat + p.lat) / 2, lng: Math.abs(pt.lng - p.lng) > 180 ? ((pt.lng + p.lng + 360) / 2) % 360 : (pt.lng + p.lng) / 2 };
  globe.focus(mid.lat, mid.lng > 180 ? mid.lng - 360 : mid.lng, Math.min(4.2, 1.9 + km / 4000));
  const verdict = km < 50 ? "W punkt!" : km < 300 ? "Bardzo blisko." : km < 1000 ? "Niedaleko." : km < 3000 ? "Ten sam kawałek świata." : "Daleko…";
  const last = q.round + 1 >= q.list.length;
  $("#view-quiz").innerHTML = `
    <div class="quiz-meta"><span>Runda <b>${q.round + 1}</b> z ${q.list.length}</span><span>Wynik <b>${q.score}</b></span></div>
    <div class="progress"><i style="width:${((q.round + 1) / q.list.length) * 100}%"></i></div>
    <p class="quiz-target"></p>
    <p class="quiz-result"><span class="pts">+${pts}</span><br>${verdict} Twój strzał był <b>${formatKm(km)}</b> od celu.</p>
    <p class="blurb"></p>
    <div class="row-buttons"><button class="solid" type="button" id="quiz-next">${last ? "Zobacz wynik" : "Dalej"}</button></div>`;
  $("#view-quiz .quiz-target").textContent = p.name;
  $("#view-quiz .blurb").textContent = `${p.region}. ${p.blurb}`;
  $("#quiz-next").onclick = () => {
    q.round += 1;
    if (q.round >= q.list.length) renderQuizEnd();
    else renderRound();
  };
  if (!isDesktop()) setSheet("peek");
}

function renderQuizEnd() {
  const q = quiz;
  const max = q.list.length * 1000;
  const record = q.score > (best[q.level.id] || 0);
  if (record) {
    best[q.level.id] = q.score;
    store.set("best", best);
  }
  globe.setPin("guess", null);
  globe.setPin("target", null);
  globe.setArc(null);
  globe.release();
  const pct = q.score / max;
  const word = pct > 0.85 ? "Mistrzowska orientacja!" : pct > 0.65 ? "Świetny wynik." : pct > 0.4 ? "Całkiem nieźle." : "Globus czeka na kolejne podejście.";
  $("#view-quiz").innerHTML = `
    <h2 class="section-title">Koniec quizu</h2>
    <p class="quiz-result"><span class="pts">${q.score}</span> / ${max}<br>${word}${record ? " <b>To twój nowy rekord!</b>" : best[q.level.id] ? ` Rekord: ${best[q.level.id]}.` : ""}</p>
    <div class="row-buttons">
      <button class="solid" type="button" id="quiz-again">Jeszcze raz</button>
      <button class="ghost" type="button" id="quiz-levels">Inny poziom</button>
      <button class="ghost" type="button" id="quiz-close">Zamknij quiz</button>
    </div>`;
  $("#quiz-again").onclick = () => startQuiz(q.level);
  $("#quiz-levels").onclick = renderQuizStart;
  $("#quiz-close").onclick = () => {
    endQuiz();
    showView("places");
  };
  if (!isDesktop()) setSheet("peek");
}

function endQuiz() {
  quiz = null;
  globe.setPin("guess", null);
  globe.setPin("target", null);
  globe.setArc(null);
  globe.setMarkersVisible(true);
  globe.setPin("home", home, 0x9fe0c0);
  globe.release();
}

// ---------- komunikaty ----------

let toastTimer = 0;
function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3600);
}

// ---------- przycisk „wstecz” na Androidzie ----------

if (native) {
  import("@capacitor/app").then(({ App }) => {
    App.addListener("backButton", () => {
      if (tour) stopTour();
      else if (mode === "quiz" && quiz) renderQuizStart();
      else if (mode !== "places") {
        if (mode === "quiz") endQuiz();
        showView("places");
      } else if (selection) clearSelection();
      else if (!isDesktop() && sheetState() === "full") setSheet("peek");
      else App.exitApp();
    });
  });
}

// ---------- start ----------

globe.setPlaces(allPlaces());
globe.setClouds(settings.clouds);
globe.setSpin(settings.spin);
globe.setPin("home", home, 0x9fe0c0);
$("#time-box").hidden = !settings.real;
setOffset(0);
renderChips();
renderHomeInfo();
showView("places");

if (import.meta.env.MODE === "web" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
