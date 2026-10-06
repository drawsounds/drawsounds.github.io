import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
const src=resolve('node_modules/spessasynth_lib/dist/spessasynth_processor.min.js');
const dst=resolve('public/spessasynth_processor.min.js');
await mkdir(dirname(dst),{recursive:true});
await copyFile(src,dst);
console.log(`Copied SpessaSynth worklet -> ${dst}`);
