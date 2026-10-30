// Wyszukiwanie miejsc (OpenStreetMap Nominatim) i opisy z polskiej Wikipedii.
// Nominatim pytamy tylko na wyraźne polecenie (Enter / przycisk), nigdy przy każdym naciśnięciu klawisza — tak każe jego regulamin.
import { distanceKm } from "./geo.js";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const WIKI = "https://pl.wikipedia.org";

/** Lista { name, region, lat, lng } dla zapytania. */
export async function searchPlaces(q) {
  const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=jsonv2&limit=8&accept-language=pl`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Nominatim " + res.status);
  return (await res.json()).map((r) => {
    const parts = r.display_name.split(", ");
    const name = r.name || parts[0];
    return {
      name,
      region: parts.filter((p) => p !== name && !/\d/.test(p)).slice(-3).join(", "),
      lat: Number(r.lat),
      lng: Number(r.lon),
      kind: r.addresstype || r.type,
    };
  });
}

const cache = new Map();

async function summary(title) {
  const res = await fetch(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
  if (!res.ok) return null;
  const s = await res.json();
  if (s.type !== "standard" || !s.extract) return null;
  return {
    title: s.title,
    extract: s.extract,
    thumb: s.thumbnail?.source || null,
    url: s.content_urls?.mobile?.page || s.content_urls?.desktop?.page,
    coords: s.coordinates ? { lat: s.coordinates.lat, lng: s.coordinates.lon } : null,
  };
}

// artykuł pasuje, jeśli opisuje miejsce bliżej niż maxKm od naszego punktu (albo nie ma współrzędnych, a jest jedynym kandydatem)
function fits(s, lat, lng, maxKm) {
  return s && (!s.coords || distanceKm(lat, lng, s.coords.lat, s.coords.lng) < maxKm);
}

/** Opis z Wikipedii dla miejsca albo null. Najpierw tytuł = nazwa, potem wyszukiwarka Wikipedii. */
export async function wikiFor({ name, lat, lng, region = "" }, maxKm = 150) {
  const key = `${name}|${lat.toFixed(2)}|${lng.toFixed(2)}`;
  if (cache.has(key)) return cache.get(key);
  const job = (async () => {
    const direct = await summary(name);
    if (fits(direct, lat, lng, maxKm) && direct.coords) return direct;
    const q = `${name} ${region.split(",")[0] || ""}`.trim();
    const res = await fetch(`${WIKI}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=4&format=json&origin=*`);
    const titles = res.ok ? (await res.json()).query?.search?.map((r) => r.title) || [] : [];
    for (const t of titles) {
      const s = await summary(t);
      if (s?.coords && fits(s, lat, lng, maxKm)) return s;
    }
    return fits(direct, lat, lng, maxKm) ? direct : null;
  })().catch(() => null);
  cache.set(key, job);
  return job;
}
