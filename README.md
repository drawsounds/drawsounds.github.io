# Draw Sounds

Draw sounds came from a shower thought — what if Kid Pix was a sound editor?

## Audio runtime

The shipped app has one synthesis path: SpessaSynth renders two purpose-built SF3 banks.

- `public/soundfonts/drawsounds-instruments.sf3` contains only the pitched presets and sample zones Draw Sounds can address.
- `public/soundfonts/drawsounds-percussion.sf3` contains only the percussion presets, keys, velocity zones, and samples Draw Sounds can address.

There are no runtime fallback banks, legacy General MIDI substitutions, alternate synth paths, or source-library conversion scripts in the deployed project. Sound IDs in `src/audio/sounds.ts` are the application contract. The two banks are cached persistently when the browser permits it, while synth parsing remains demand-driven to avoid wasting mobile memory.


## Musical phrase runtime

Drawing gestures compile into bounded musical phrases before they reach the audio scheduler. Pointer movement maintains a constant-size gesture summary (register, contour, travel, curvature, energy) so live drawing does not repeatedly analyze the full stroke. Committed phrases are cached per mark and per preceding motif signature; appending a mark normally compiles only the new phrase.

- Tango and Flamenco keep their named performance techniques and conservative idiomatic phrase rules.
- Zouk uses a restrained repeating dance-groove vocabulary rather than the high-mutation generator.
- Dreamland is intentionally sparse, slow, legato, suspended, and low-velocity.
- Pop Star, Rock Monster, Salsa Party, Drum Circle, and Weird Cabinet use deterministic four-phrase motif development: statement, variation, contrast, cadence.

The phrase layer has hard event bounds and never runs inside the AudioWorklet. The audio thread still receives only scheduled MIDI-style note events and renders the two canonical SoundFont banks.
