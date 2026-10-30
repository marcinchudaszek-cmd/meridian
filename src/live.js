// Dane na żywo bez three.js — testowane w tests/live.test.js.
import { sunAltitude } from "./geo.js";

export const QUAKES_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson";
export const ISS_TLE_URL = "https://api.wheretheiss.at/v1/satellites/25544/tles";

/** GeoJSON z USGS → lista { id, mag, lat, lng, depth, time, place, url }, najsilniejsze na końcu (rysowane na wierzchu). */
export function parseQuakes(geojson) {
  return (geojson.features || [])
    .filter((f) => f.geometry && Number.isFinite(f.properties?.mag))
    .map((f) => ({
      id: f.id,
      mag: f.properties.mag,
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      depth: f.geometry.coordinates[2],
      time: f.properties.time,
      place: f.properties.place || "",
      url: f.properties.url,
      tsunami: f.properties.tsunami === 1,
    }))
    .sort((a, b) => a.mag - b.mag);
}

/** „przed chwilą”, „25 min temu”, „3 godz. temu”, „2 dni temu”. */
export function ago(ms, now = Date.now()) {
  const min = Math.max(0, Math.round((now - ms) / 60000));
  if (min < 2) return "przed chwilą";
  if (min < 60) return `${min} min temu`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} godz. temu`;
  const d = Math.round(h / 24);
  return d === 1 ? "wczoraj" : `${d} dni temu`;
}

/** Słowna skala siły trzęsienia. */
export function quakeLabel(mag) {
  if (mag >= 7) return "bardzo silne";
  if (mag >= 6) return "silne";
  if (mag >= 5) return "umiarkowane";
  if (mag >= 4) return "lekkie";
  return "słabe";
}

export function formatMag(mag) {
  return "M " + mag.toFixed(1).replace(".", ",");
}

/**
 * Czy stacja na danej wysokości jest w słońcu: widzi je jeszcze, gdy pod nią Słońce
 * zaszło o mniej niż kąt depresji horyzontu acos(R / (R + h)).
 */
export function inSunlight(lat, lng, altKm, date) {
  const dip = (Math.acos(6371 / (6371 + altKm)) * 180) / Math.PI;
  return sunAltitude(lat, lng, date) > -dip;
}

/** Ten sam rok i dzień co „wczoraj” w UTC — zdjęcia NASA z danego dnia są kompletne po kilku godzinach. */
export function yesterdayUTC(now = new Date()) {
  return new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
}

/** Nakładki danych NASA GIBS: które warstwy, z którego dnia (opóźnienie danych) i czy barwić na jeden kolor. */
export const NASA_LAYERS = {
  fires: { layers: "VIIRS_SNPP_Thermal_Anomalies_375m_All,VIIRS_NOAA20_Thermal_Anomalies_375m_All", daysAgo: 1, tint: null },
  sst: { layers: "GHRSST_L4_MUR_Sea_Surface_Temperature", daysAgo: 2, tint: null },
  snow: { layers: "MODIS_Terra_L3_Snow_Extent_8Day,GHRSST_L4_MUR_Sea_Ice_Concentration", daysAgo: 9, tint: 0x9fdcff },
};

export function nasaUrl(kind, width, now = new Date()) {
  const cfg = NASA_LAYERS[kind];
  const date = new Date(now.getTime() - cfg.daysAgo * 86400000).toISOString().slice(0, 10);
  return {
    date,
    url:
      "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0" +
      `&LAYERS=${cfg.layers}&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=${width}&HEIGHT=${width / 2}&FORMAT=image/png&TRANSPARENT=true&TIME=${date}`,
  };
}

export function photoUrl(date, width) {
  const layers = "VIIRS_SNPP_CorrectedReflectance_TrueColor,VIIRS_NOAA20_CorrectedReflectance_TrueColor";
  return (
    "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0" +
    `&LAYERS=${layers}&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=${width}&HEIGHT=${width / 2}&FORMAT=image/jpeg&TIME=${date}`
  );
}
