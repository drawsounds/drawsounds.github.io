export type RuntimeBank = 'instruments' | 'percussion';

const BANKS: Record<RuntimeBank,{path:string;offset:number}> = {
  instruments: {path:'soundfonts/drawsounds-instruments.sf3',offset:0},
  percussion: {path:'soundfonts/drawsounds-percussion.sf3',offset:1},
};

export const SOUNDS = {
  piano: {bank:'instruments',program:0},
  lately_bass: {bank:'instruments',program:1},
  warm_pad: {bank:'instruments',program:2},
  tubular_bells: {bank:'instruments',program:3},
  harp: {bank:'instruments',program:4},
  choir_aahs: {bank:'instruments',program:5},
  ocarina: {bank:'instruments',program:6},
  saw_hook: {bank:'instruments',program:7},
  electric_piano: {bank:'instruments',program:8},
  synth_vox: {bank:'instruments',program:9},
  crystal: {bank:'instruments',program:10},
  finger_bass: {bank:'instruments',program:11},
  clean_guitar: {bank:'instruments',program:12},
  fret_noise: {bank:'instruments',program:13},
  acoustic_bass: {bank:'instruments',program:14},
  brass: {bank:'instruments',program:15},
  marimba: {bank:'instruments',program:16},
  voice_oohs: {bank:'instruments',program:17},
  alto_sax: {bank:'instruments',program:18},
  nylon_guitar: {bank:'instruments',program:19},
  bandoneon: {bank:'instruments',program:20},
  violin: {bank:'instruments',program:21},
  upright_piano: {bank:'instruments',program:22},
  cello: {bank:'instruments',program:23},
  tenor_sax: {bank:'instruments',program:24},
  flamenco_strum: {bank:'instruments',program:25},
  theremin: {bank:'instruments',program:26},
  hurdy_gurdy: {bank:'instruments',program:27},
  waterphone: {bank:'instruments',program:28},
  nyckelharpa: {bank:'instruments',program:29},
  ondioline: {bank:'instruments',program:30},
  musical_saw: {bank:'instruments',program:31},

  pop_kit: {bank:'percussion',program:0},
  world_percussion: {bank:'percussion',program:1},
  rock_kit: {bank:'percussion',program:2},
} as const satisfies Record<string,{bank:RuntimeBank;program:number}>;

export type SoundId = keyof typeof SOUNDS;
export const soundSpec=(sound:SoundId)=>SOUNDS[sound];
export const bankOffset=(bank:RuntimeBank)=>BANKS[bank].offset;

function assetUrl(path:string){
  const base=import.meta.env.BASE_URL||'./';
  const prefix=base.endsWith('/')?base:`${base}/`;
  return `${prefix}${path}`;
}

export async function fetchRuntimeBank(bank:RuntimeBank){
  const response=await fetch(assetUrl(BANKS[bank].path));
  if(!response.ok)throw new Error(`Audio asset unavailable (${response.status})`);
  return response.arrayBuffer();
}
