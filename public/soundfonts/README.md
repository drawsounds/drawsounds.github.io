# DrawSounds runtime audio

The app ships exactly two SoundFonts:

- `drawsounds-instruments.sf3` — every pitched/tonal preset DrawSounds can address.
- `drawsounds-percussion.sf3` — the three percussion presets DrawSounds can address.

The banks are purpose-built runtime assets. Unreachable source presets, key zones, velocity layers, and samples are not shipped. Runtime code addresses stable `sound` IDs that map directly to these preset numbers; there is no GM fallback or alternate synthesis path.

Third-party source notices are consolidated in `THIRD_PARTY_LICENSES.txt`.
