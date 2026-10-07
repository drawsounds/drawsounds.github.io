# DrawSounds runtime audio

Two SF3 banks cover the current nine worlds, six drawing tools, seven stamps,
relationship notes, glides and captured live performances. Patterns are generated
by `src/music/phraseEngine.ts`; SoundFonts store their instruments, key zones and
velocity layers, rather than copies of the patterns.

| Bank | Presets | Samples | Download | Decoded PCM, if every sample is used |
| --- | ---: | ---: | ---: | ---: |
| `drawsounds-instruments.sf3` | 33 | 256 | 6.19 MiB | 123.75 MiB |
| `drawsounds-percussion.sf3` | 6 | 92 | 2.14 MiB | 40.15 MiB |

The previous banks totaled 13.05 MiB; these total 8.33 MiB (36% smaller).
Percussion alone is 69% smaller, with 263 fewer samples. Decoded sizes are upper
bounds, not startup allocations: the synthesizer decodes samples as needed.
Only banks required by the selected world are fetched. Drum Circle needs only
percussion, Dreamland/Weird Cabinet/Tango need only instruments, and mixed worlds
need both. Loaded banks are reused on world changes; fetch buffers are transferred
to the worklet without retaining another compressed copy. Voices are capped at 128
with automatic voice allocation disabled to bound real-time work on both mobile
and desktop.

## Instrument coverage

`src/audio/sounds.ts` defines the stable IDs, programs, supported pitch registers
and velocity limits. `inventory.json` records the exact file checksums, presets,
sample counts, supported keys and notes observed in the regression corpus.

- Restore the lower bass and upper bell, harp, ocarina, guitar, bandoneón, piano
  and sax registers that current stamps and strokes reach. Extend edge zones
  using their existing sample tuning; preserve the original compressed recordings.
  The surviving quiet tenor-sax layer also covers upper velocities in its low
  register, avoiding silent accents.
- Keep Ondioline and Flamenco Strum: stamp and guitar articulation overrides reach
  them even though they are not direct palette choices.
- Glass Harmonica has its own program, built from four sampled rubbed wine glasses
  with crossfaded sustain loops. It is a glass-instrument approximation, separate
  from the Pop Star crystal sound.
- Drum Circle uses real sampled djembe bass, tone, slap and muted hits, plus a real
  shekere hit and the FreePats fast/soft egg shakers. Bongos, low conga/darbuka,
  claves and conga ensemble labels match their actual recordings. Talking drum,
  dun-dun and batá were previously labels for other instruments; those misleading
  names are removed. No purported authentic replacements are synthesized.
- Salsa has a dedicated kit: FreePats congas/claves, two isolated timbale strikes
  and three sampled cowbell dynamics. Bell/rim patterns now trigger bell/timbale
  samples instead of maracas. Flamenco keeps its cajón, clap, clave and castanet
  articulations; Pop and Rock retain their existing kit mappings.
- Three sampled percussion layers replace the dense velocity variants in World,
  Rock and Salsa. Stereo rock samples stay linked. Only reachable key zones,
  layers and their referenced samples remain. New recordings are mono at 32 kHz,
  peak balanced, trimmed with short edge fades and Vorbis encoded at quality 5.
- Drum relationships retain their articulation keys. Pitched relationship notes
  fold by octaves into their instrument's supported register when necessary.

The preexisting Theremin, Hurdy Gurdy, Waterphone, Nyckelharpa, Ondioline and
Musical Saw remain documented creative synthesized approximations. Specialist
recordings and source notices are preserved in `THIRD_PARTY_LICENSES.txt`.

## Validate and rebuild

Run `npm ci`, then `npm run check`. The audio audit checks every supported
key/velocity pair, sample decoding, unused presets/samples, stereo dependencies,
worklet compatibility and roughly 794,000 events across 94,608 fixtures. It also
renders every sound at 44.1 and 48 kHz and rejects silent or non-finite output.
The corpus includes every palette/tool/stamp, register edges, several stroke
contours, deterministic seeds, repeated voices, relationships and live captures.
It is a regression corpus, not a proof of every possible gesture; supported
registers retain margins around the generated notes.

`npm run audio:build -- /path/to/source-cache` rebuilds the assets. Requirements:
Node 20.11+, Git, curl, FFmpeg for decoding, and either FFmpeg with libvorbis or
Python 3 plus libsndfile for encoding. No source downloads occur during the normal
app build or audit. The builder uses the frozen seed banks from Git commit
`949fbdf38c879183d6821fa52000b8d4fea27abb` (a full clone is needed for first-time
seed extraction), then downloads the selected CC0 recordings into the cache.
`scripts/soundfont-sources.json` pins URLs, authors, licenses, the VCSL revision
and SHA-256 checksums for every input. Cached inputs are checked before use.
Encoding failures abort instead of silently adding uncompressed samples.

After rebuilding, run `npm run audio:inventory` to validate and refresh the
inventory, then `npm run check`. Vorbis encoder/container metadata can differ
between platforms, so output checksums must be regenerated after a rebuild.
Presets and runtime metadata must change together. On a synthesizer upgrade,
update the public worklet while preserving its local queued-note panic fix;
the audit checks that the remaining worklet matches the installed package.
