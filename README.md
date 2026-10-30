# Meridian — atlas nocy

Interaktywny globus 3D z prawdziwym dniem i nocą. Obracasz Ziemię palcem, dotykasz miejsca i widzisz, która tam godzina, jak wysoko stoi Słońce i jak daleko jest od twojego punktu.

Aplikacja na Androida (`com.beagleappsstudio.meridian`) i wersja web na https://beagleapps.pl/apps/meridian/. Bez konta i bez serwera — ulubione, własne miejsca, „mój punkt” i rekordy quizu zostają na urządzeniu.

## Funkcje

- **prawdziwe słońce** — linia dnia i nocy liczona z pozycji Słońca w tej chwili, światła miast po nocnej stronie, odblask słońca na oceanach; suwak przesuwa czas o ±24 h
- **zbliżenia satelitarne** — z bliska globus doczytuje zdjęcia Sentinel-2 (ok. 10 m na piksel) z nazwami miejscowości z OpenStreetMap; przybliżanie kółkiem, szczypnięciem, przyciskami +/−, podwójnym dotknięciem albo „Przybliż” w karcie miejsca
- **warstwy na żywo** — trzęsienia ziemi z 7 dni (USGS), ISS z orbitą liczoną z aktualnych elementów orbity i śledzeniem kamerą, granice i polskie nazwy państw ze stolicami (dotknięcie lądu pokazuje kraj), siatka (równik, zwrotniki, koła podbiegunowe, południki co 15°) i „Ziemia z wczoraj” — dzienne zdjęcie planety z satelitów NASA
- **szukanie dowolnego miejsca na świecie** (OpenStreetMap Nominatim, tylko na wyraźne polecenie) i **opisy z Wikipedii** ze zdjęciem przy miejscach
- **mapa podróży** — „Byłem tu” przy kraju, odwiedzone kraje podświetlone na globusie, licznik krajów i kontynentów
- **dane NASA** — pożary z wczoraj, temperatura oceanów, śnieg i lód morski (jedna nakładka naraz, z legendą)
- **prawdziwe niebo** — gwiazdy do 6 mag z katalogu Yale, linie i polskie nazwy 88 gwiazdozbiorów, ustawione wg czasu gwiazdowego
- **Księżyc** w prawdziwym położeniu i fazie (algorytm Meeusa), karta z fazą, wiekiem i dniami do pełni
- **udostępnianie widoku** linkiem `#m=szer,dł,wysokość,id`
- **144 miejsca** w kategoriach Polska, Niemcy, miasta, cuda i zabytki, przyroda — z czasem lokalnym (strefy IANA) i stanem dnia przy każdym
- **wyszukiwarka** odporna na polskie znaki, ulubione, **własne miejsca** (dotknij globusu → „Dodaj do moich miejsc”)
- **mój punkt** — z lokalizacji albo dotknięty na globusie; przy każdym miejscu odległość, szacowany czas lotu i łuk trasy po wielkim kole
- **quiz „Gdzie to jest?”** — 10 rund, cztery poziomy (łatwy, cały świat, Polska, Niemcy), do 1000 punktów za rundę, rekordy
- **wycieczka** — kamera sama przelatuje po miejscach z bieżącej listy
- dotknięcie dowolnego punktu Ziemi: współrzędne, czas słoneczny, wysokość Słońca

## Praca lokalnie

```bash
npm.cmd install
npm.cmd run dev
npm.cmd test
```

Podgląd w aplikacji Claude: serwery `meridian` (dev, port 5190) i `meridian-web` (build web, 5191) w `Desktop\.claude\launch.json`.

## Budowanie

- wersja web: `npm.cmd run build:web` → `dist-web/`, kopia do `moje-aplikacje-strona/apps/meridian/`
  (po zmianie tekstur podbij `CACHE` w `public/sw.js` — tekstury nie mają skrótu w nazwie)
- Android: `npm.cmd run build:android`, potem w `android/` `gradlew.bat assembleRelease --no-daemon` (JDK 21)
- klucz wydania: `scripts/nowy-klucz.ps1` (raz; hasło wpisuje się ręcznie, plik i hasło poza repo)
- ikony i grafiki do Play: `python scripts/ikony.py`
- tekstury: `python scripts/tekstury.py <folder z plikami NASA>` (źródła opisane w skrypcie)

## Źródła

- Zdjęcia Ziemi: NASA Visible Earth — Blue Marble Next Generation (grudzień 2004), Black Marble 2016, mozaika chmur. Domena publiczna.
- Warstwy: trzęsienia ziemi USGS (domena publiczna), granice i stolice Natural Earth (domena publiczna, `scripts/kraje.py`), orbita ISS z wheretheiss.at + satellite.js (MIT), zdjęcie dnia NASA GIBS (VIIRS Suomi NPP i NOAA-20).
- Zbliżenia: Sentinel-2 cloudless — https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016), CC BY 4.0. Nazwy miejscowości: © OpenStreetMap contributors, opracowanie EOX.
- Opisy: Wikipedia (CC BY-SA 4.0). Wyszukiwanie: OpenStreetMap Nominatim. Niebo: d3-celestial, Olaf Frohn (BSD-3), katalog Yale Bright Star (`scripts/niebo.py`). Księżyc: NASA SVS CGI Moon Kit.
- Silnik 3D: [three.js](https://threejs.org) (MIT). Czcionki: Fraunces i Outfit (SIL Open Font License).
- Pierwsza wersja wizualna powstała w Grok Build; kod przepisany od nowa na Vite + three.js + Capacitor.

Kontakt: beagleappsstudio@gmail.com
