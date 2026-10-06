# Aura SoundFonts

Aura v0.26 uses local **SF3** files as its audible instrument sources. SF3 keeps the SoundFont structure while storing samples as Ogg/Vorbis, which dramatically reduces the desktop bundle size.

## General / creative banks
- `TimGM6mb.sf3` — compact GM fallback and general palette.
- `Aura-Oddities.sf3` — Weird Cabinet.

## Specialist banks
- `Aura-Bandoneon.sf3` — Jörg Bleymehl / Bandonberry bandoneon_v2 source; recorded 1930 ELA bandoneon.
- `Aura-NylonGuitar.sf3` — FreePats Spanish classical guitar; CC0.
- `Aura-FlamencoStrum-DrJass.sf3` — alternate Flamenco strum source supplied for the project.
- `Aura-FingerBass.sf3` — FreePats Finger Bass YR; CC0.
- `Aura-WorldPercussion.sf3` — FreePats World Percussion; CC0.
- `Aura-CleanGuitar.sf3` — FreePats clean Fender electric guitar; CC0.

## Quality banks
The `optional/` folder name is retained for path compatibility, but these banks are bundled in this build:
- `UprightPianoKW-small.sf3`
- `TenorSaxophone-small.sf3`
- `ConcertHarp-small.sf3`
- `TubularBells-small.sf3`
- `Ocarina.sf3`
- `LatelyBass.sf3`
- `MuldjordKit.sf3`

Every shipped SF3 is below Aura's 25 MiB per-bank limit. See `SOUNDFONT-SF3.md` and `licenses/` for size/provenance details.
