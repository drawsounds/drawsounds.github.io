# Aura Musical Sketch Pad v0.24

Aura is a touch-first musical paint toy. Draw, spray, stamp, fill and erase color on the canvas; the picture becomes the score.

## What changed in v0.20

This is a deletion/refactor pass rather than a feature pile-up. The music engine is now built around five concepts only:

**Mark → Gesture → Performer → World → Studio**

The old generic style taxonomy, mood enum, fake instrument IDs, large voice-kind taxonomy, ensemble-role stack, record-character stack and engineer-rescue layer have been removed.

Each color in a world now directly owns:
- its SoundFont bank/program
- its musical role
- register
- channel behavior
- room/echo/drive preferences

Each world directly owns:
- musical form
- emotional direction
- harmony/scale
- relationship reach
- its six performers
- its studio profile
- its stamp vocabulary

## Worlds

- Dreamland
- Drum Circle
- Pop Star
- Rock Monster
- Salsa Party
- Weird Cabinet
- Zouk
- Flamenco
- Tango

Flamenco and Tango use specialist stamp trays rather than generic stamps.

### Flamenco stamps
Rasgueado, Abanico, Golpe, Picado, Alzapúa, Llamada, Remate.

### Tango stamps
Marcato 2, Marcato 4, Síncopa, Arrastre, Milonga, Yumba, Bordoneo.

The technique stamp is interpreted by the selected color. An arrastre on bandoneón, bass or piano therefore becomes a related but instrument-appropriate gesture rather than a fixed MIDI clip.

## Relationships

Relationships are intentionally simple and discoverable:
- touching/overlapping: harmonize
- bass + drums: play together
- nearby/ordered marks: respond

A mark keeps its committed core phrase. Relationships add around it instead of rewriting what the child drew.

## Sound

All audible instrument sources are SoundFonts. The regular worlds currently use the compact TimGM6mb bank with direct per-color program mapping. Weird Cabinet uses the bundled Aura-Oddities bank.

The studio path is deliberately small:

SoundFont → color channel strip → room/echo sends → world studio → safety compressor

No legacy oscillator/source engine is present.


### Tango palette update
The sixth Tango color is now alto sax (GM program 65) instead of the former accordion breath/air layer.


## v0.20 specialist SoundFont upgrade

The specialist worlds now use dedicated local SF2 banks for bandoneón, nylon guitar, finger bass and hand/world percussion. Tango's sixth color is sax. The generated specialist banks are compact, self-contained and mapped directly by performer; TimGM remains a general fallback rather than the source of the defining Flamenco/Tango/percussion timbres.


## v0.20 real specialist SoundFonts

v0.20 replaces the provisional generated bandoneon, nylon-guitar, finger-bass and world-percussion banks with the real external SoundFonts supplied through the manual asset bundle. It also adds the real FreePats clean Fender guitar bank for Zouk and Rock. The FreePats percussion MIDI map is now matched exactly instead of using the provisional note layout.

### Flamenco guitar update (v0.21)
Flamenco now uses a dual-SoundFont strategy: the existing FreePats classical guitar for precise single-note techniques, and the user-supplied stereo DrJass Spanish guitar for rasgueado/abanico/golpe/llamada/remate chordal gestures.

## v0.22 sound-source optimization

Aura now supports a compact optional quality tier. The app still runs entirely from the bundled SoundFonts, but selected performers automatically prefer higher-quality local SF2 banks when they are present and fall back to the existing bank when they are not.

Run `scripts/fetch_optional_quality_soundfonts.sh` to install the compact upgrade set, or read `SOUNDFONT-OPTIMIZATION.md` for the exact sources and rationale. Use `--with-rock-drums` only if the extra ~53 MiB acoustic drum kit is acceptable.

Upgraded targets: Tango piano + sax, Dreamland harp/bells/ocarina, Dreamland/Pop synth bass, and optionally Rock acoustic drums. The already-strong specialist sources (bandoneón, Flamenco guitars, world percussion, clean electric guitar, finger bass) are retained.

## Installed quality SoundFonts (v0.23)

The uploaded FreePats tenor sax and concert harp banks are now bundled directly and are authoritative (no GM fallback in normal builds). The uploaded Kawai upright piano, Lately Bass, Ocarina, and Tubular Bells archives are preserved in `assets-to-extract/`; run `./scripts/install_uploaded_quality_soundfonts.sh` after `brew install sevenzip` to install them into the exact filenames the app already expects.


## v0.24 quality-pack completion

The user-supplied Kawai upright piano, Lately Bass, Ocarina, Tubular Bells and MuldjordKit archives have been extracted and bundled alongside the previously integrated tenor sax and concert harp. The four compact banks are now normal authoritative sources, and Rock can use the full sampled MuldjordKit. Rock's drum-note mapping was corrected to the SF2's native 48–66 layout.


## v0.26 desktop-size pass

The drawing canvas now uses the full available window width on desktop, and bundled specialist SF2 banks are structurally trimmed to Aura's actual note usage. The SoundFont payload falls from roughly 313 MiB to 150 MiB without lossy sample conversion. See `SOUNDFONT-SIZE-OPTIMIZATION.md`.


## SF3 runtime
Aura v0.26 uses SpessaSynth for SF3 playback. All runtime SoundFont banks are Ogg/Vorbis-compressed and capped at 25 MiB each.
