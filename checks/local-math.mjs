import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareInput,postprocess,compareResults} from '../src/local-inference.js';
const directory=await mkdtemp(join(tmpdir(),'pill-local-math-'));
try{
execFileSync('python',['-c',`
import sys,types,json,pathlib
import numpy as np
from PIL import Image
stub=types.ModuleType('ai_edge_litert.interpreter');stub.Interpreter=None
sys.modules['ai_edge_litert']=types.ModuleType('ai_edge_litert');sys.modules['ai_edge_litert.interpreter']=stub
from detection_engine import prepare_input,postprocess
root=pathlib.Path(sys.argv[1]);cases=[]
for i,(w,h) in enumerate([(7,7),(103,79),(79,103),(833,831),(2048,1333)]):
 data=((np.arange(w*h*4,dtype=np.uint32)*37+11)%256).astype(np.uint8).reshape(h,w,4)
 data.tofile(root/f'{i}.rgba');tensor,_,_=prepare_input(Image.fromarray(data,'RGBA'));tensor.tofile(root/f'{i}.tensor')
 cases.append(dict(width=w,height=h))
(root/'cases.json').write_text(json.dumps(cases))
rng=np.random.default_rng(42)
raw=np.zeros((14196,5),np.float32)
raw[:3000,:2]=rng.uniform(-.1,1.1,(3000,2));raw[:3000,2:4]=rng.uniform(.001,.15,(3000,2));raw[:3000,4]=rng.uniform(.45,1,3000)
raw[3000:3010]=raw[:10];raw[3000:3010,4]=raw[:10,4]
raw[3010]=[.5,.5,.1,.1,np.nan];raw[3011]=[.5,.5,.1,.1,np.inf]
raw[3012]=[np.inf,.5,.1,.1,.9];raw[3013]=[.5,.5,.001,.1,.9]
raw[3014]=[.5,.5,.01,.01,np.nextafter(np.float32(.5),np.float32(0))]
raw[3015]=[.5,.5,.01,.01,.5];raw[3016]=[.2,.2,.3,.3,.9]
raw[3017]=[.5,.5,833,834,.9]
raw.T.copy().tofile(root/'output.bin')
for i,(w,h) in enumerate([(640,640),(103,79),(79,103)]):
 (root/f'objects{i}.json').write_text(json.dumps(postprocess(raw,w,h)))
`,directory],{cwd:process.cwd(),stdio:['ignore','pipe','pipe']});
 const cases=JSON.parse(await readFile(join(directory,'cases.json')));
 for(const [i,{width,height}] of cases.entries()){
  const data=new Uint8ClampedArray(await readFile(join(directory,`${i}.rgba`))),expected=await readFile(join(directory,`${i}.tensor`));
  const actual=prepareInput({data,width,height});assert.deepEqual(Buffer.from(actual.buffer),expected,`exact float32 preprocessing ${width}x${height}`);
 }
 const buffer=await readFile(join(directory,'output.bin'));const raw=new Float32Array(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));
 for(const [i,[w,h]] of [[640,640],[103,79],[79,103]].entries()){
  const expected=JSON.parse(await readFile(join(directory,`objects${i}.json`))),actual=postprocess(raw,w,h);
  assert.deepEqual(actual.map(o=>o.queryIndex),expected.map(o=>o.queryIndex));
  for(let j=0;j<actual.length;j++)for(const key of ['bbox','x','y','confidence','area'])assert.deepEqual(actual[j][key],expected[j][key],`postprocess ${i}/${j}/${key}`);
 }
 const box=(x,confidence=.9)=>({bbox:[x,0,10,10],confidence});
 assert.equal(compareResults([box(0),box(30)],[box(0),box(60)]).matched,1);
 assert.equal(compareResults([box(0),box(0)],[box(0)]).localOnly,1);
 assert.equal(compareResults([],[]).minIou,null);
 console.log('PASS exact Python/JS float32 preprocessing on 5 RGBA fixtures and postprocessing on 14,196 candidates (ties, NaN, infinity, thresholds, NMS limit, clipping); one-to-one comparison');
}finally{await rm(directory,{recursive:true,force:true});}
