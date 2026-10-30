# Zakłada klucz wydania Meridiana: android\release.keystore + android\keystore.properties.
# Hasło wpisuje się tutaj (nie trafia do historii poleceń ani do repo).
# Uruchom raz: powershell -ExecutionPolicy Bypass -File scripts\nowy-klucz.ps1
$ErrorActionPreference = 'Stop'
$android = Join-Path $PSScriptRoot '..\android' | Resolve-Path
$ks = Join-Path $android 'release.keystore'
$props = Join-Path $android 'keystore.properties'
if (Test-Path $ks) { Write-Host "Klucz już istnieje: $ks — nic nie zmieniam."; exit 1 }

$keytool = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot\bin\keytool.exe'

function Czytaj($tekst) {
  $s = Read-Host $tekst -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
$h1 = Czytaj 'Hasło do klucza Meridiana (min. 6 znaków)'
$h2 = Czytaj 'Powtórz hasło'
if ($h1 -ne $h2) { Write-Host 'Hasła się różnią — przerwane.'; exit 1 }
if ($h1.Length -lt 6) { Write-Host 'Za krótkie hasło — przerwane.'; exit 1 }

& $keytool -genkeypair -keystore $ks -storetype PKCS12 -alias meridian `
  -keyalg RSA -keysize 2048 -validity 10000 `
  -dname 'CN=Beagleapps, OU=Marcin, O=Beagleapps' -storepass $h1 -keypass $h1
if ($LASTEXITCODE -ne 0) { Write-Host 'keytool zgłosił błąd.'; exit 1 }

# Bez BOM — inaczej Gradle nie odczyta pierwszego klucza.
$tresc = "storeFile=release.keystore`nstorePassword=$h1`nkeyAlias=meridian`nkeyPassword=$h1`n"
[IO.File]::WriteAllText($props, $tresc, (New-Object Text.UTF8Encoding $false))

# Kopia klucza do folderu z kluczami (bez hasła — hasło zna tylko Marcin)
$kopia = 'C:\Users\Ezra\Desktop\klucze i hasla\Meridian-klucz'
New-Item -ItemType Directory -Force $kopia | Out-Null
Copy-Item $ks $kopia

Write-Host ''
Write-Host "Gotowe: $ks"
Write-Host "Kopia pliku klucza: $kopia"
Write-Host 'Zapisz hasło w swoim miejscu na hasła i zrób kopię na dysku D: — bez nich nie wydasz aktualizacji.'
