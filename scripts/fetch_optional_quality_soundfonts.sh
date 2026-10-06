#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/soundfonts/optional"
TMP="$ROOT/.soundfont-downloads"
mkdir -p "$OUT" "$TMP"

need_cmd(){ command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1"; exit 1; }; }
need_cmd curl

extract_one(){
  local archive="$1" target="$2"
  local work="$TMP/extract-$(basename "$target" .sf2)"
  rm -rf "$work"; mkdir -p "$work"
  case "$archive" in
    *.7z)
      if command -v 7zz >/dev/null 2>&1; then 7zz x -y "-o$work" "$archive" >/dev/null
      elif command -v 7z >/dev/null 2>&1; then 7z x -y "-o$work" "$archive" >/dev/null
      else echo "Need 7zip for $(basename "$archive"). macOS: brew install sevenzip"; return 1; fi ;;
    *.tar.bz2) tar -xjf "$archive" -C "$work" ;;
    *.tar.xz) tar -xJf "$archive" -C "$work" ;;
    *) echo "Unknown archive format: $archive"; return 1 ;;
  esac
  local sf2
  sf2="$(find "$work" -type f -iname '*.sf2' | head -1 || true)"
  if [[ -z "$sf2" ]]; then echo "No SF2 found in $archive"; return 1; fi
  cp -f "$sf2" "$OUT/$target"
  echo "Installed $target"
}

download(){
  local name="$1" url="$2" target="$3"
  local dest="$TMP/$name"
  echo "==> $target"
  if [[ -s "$OUT/$target" ]]; then echo "Already installed"; return 0; fi
  if ! curl -L --fail --retry 3 --connect-timeout 15 -A 'Mozilla/5.0 AuraSoundfontFetcher/1.0' -o "$dest.part" "$url"; then
    rm -f "$dest.part"
    echo "FAILED: $url"
    return 1
  fi
  mv "$dest.part" "$dest"
  extract_one "$dest" "$target"
}

failed=0

download 'UprightPianoKW-small-SF2-20190703.7z' \
  'https://freepats.zenvoid.org/Piano/UprightPianoKW/UprightPianoKW-small-SF2-20190703.7z' \
  'UprightPianoKW-small.sf2' || failed=1

download 'TenorSaxophone-small-SF2-20200717.tar.bz2' \
  'https://freepats.zenvoid.org/Reed/TenorSaxophone/TenorSaxophone-small-SF2-20200717.tar.bz2' \
  'TenorSaxophone-small.sf2' || failed=1

download 'ConcertHarp-small-SF2-20200702.tar.xz' \
  'https://freepats.zenvoid.org/OrchestralStrings/ConcertHarp/ConcertHarp-small-SF2-20200702.tar.xz' \
  'ConcertHarp-small.sf2' || failed=1

download 'TubularBells-small-SF2-20241130.7z' \
  'https://github.com/freepats/tubular-bells1/releases/download/2024-11-30/TubularBells-small-SF2-20241130.7z' \
  'TubularBells-small.sf2' || failed=1

download 'Ocarina-SF2-20241002.7z' \
  'https://github.com/freepats/ocarina1/releases/download/2024-10-02/Ocarina-SF2-20241002.7z' \
  'Ocarina.sf2' || failed=1

download 'LatelyBass-SF2-20240409.7z' \
  'https://github.com/freepats/lately-bass/releases/download/2024-04-09/LatelyBass-SF2-20240409.7z' \
  'LatelyBass.sf2' || failed=1

if [[ "${1:-}" == "--with-rock-drums" ]]; then
  download 'MuldjordKit-SF2-20201018.7z' \
    'https://github.com/freepats/muldjordkit/releases/download/2020-10-18/MuldjordKit-SF2-20201018.7z' \
    'MuldjordKit.sf2' || failed=1
fi

echo
if [[ "$failed" == 0 ]]; then
  echo "All requested optional SoundFonts installed into: $OUT"
else
  echo "Some downloads failed. Aura will keep using its built-in fallback banks for those instruments."
  echo "See SOUNDFONT-OPTIMIZATION.md for landing pages and manual fallback URLs."
fi
