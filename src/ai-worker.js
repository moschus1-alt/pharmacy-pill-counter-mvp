import * as ort from '../vendor/ort/ort.wasm.bundle.min.mjs';
import {suppressContainerDetections} from './ai-postprocess.js';
ort.env.wasm.numThreads=1;
ort.env.wasm.wasmPaths=new URL('../vendor/ort/',import.meta.url).href;
let session,modelInfo;
async function initialize(){
 if(session)return;
 self.postMessage({progress:'AI 모델을 불러오는 중입니다. 첫 실행은 시간이 걸릴 수 있어요.'});
 modelInfo=await fetch(new URL('../models/model-info.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('모델 정보를 읽을 수 없습니다.');return r.json();});
 const manifest=await fetch(new URL('../models/parts.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('모델 목록을 읽을 수 없습니다.');return r.json();});
 const model=new Uint8Array(manifest.bytes);let offset=0;
 for(const part of manifest.parts){
  self.postMessage({progress:`AI 모델 다운로드 ${Math.round(offset/manifest.bytes*100)}% · 첫 실행 약 211MB`});
  const response=await fetch(new URL('../models/'+part.file,import.meta.url));
  if(!response.ok)throw Error('모델 다운로드에 실패했습니다. Wi-Fi 연결을 확인해 주세요.');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length!==part.bytes)throw Error('모델 파일이 불완전합니다. 다시 시도해 주세요.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==part.sha256)throw Error('모델 파일 검증에 실패했습니다. 다시 시도해 주세요.');
  model.set(bytes,offset);offset+=bytes.length;
 }
 if(offset!==manifest.bytes)throw Error('모델 크기가 일치하지 않습니다.');
 self.postMessage({progress:'AI 모델을 준비하고 있습니다. 잠시 기다려 주세요.'});
 session=await ort.InferenceSession.create(model,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
}
self.onmessage=async({data:{imageData,parameters={}}})=>{
 try{
  await initialize();self.postMessage({progress:'AI가 알약 위치를 추론하고 있습니다.'});
  const start=performance.now(),{width,height}=imageData,size=640;
  const original=new OffscreenCanvas(width,height);original.getContext('2d').putImageData(imageData,0,0);
  const resized=new OffscreenCanvas(size,size),ctx=resized.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='low';ctx.drawImage(original,0,0,size,size);
  const rgba=ctx.getImageData(0,0,size,size).data,plane=size*size,tensor=new Float32Array(plane*3);
  for(let i=0;i<plane;i++){tensor[i]=(rgba[i*4]/255-.485)/.229;tensor[plane+i]=(rgba[i*4+1]/255-.456)/.224;tensor[plane*2+i]=(rgba[i*4+2]/255-.406)/.225;}
  const input=new ort.Tensor('float32',tensor,[1,3,size,size]);
  let output;try{output=await session.run({image:input});}finally{input.dispose();}
  const scores=output.scores,labels=output.labels,boxes=output.boxes;
  if(!scores||!labels||!boxes||boxes.dims[2]!==4)throw Error('예상하지 못한 모델 출력 형식입니다.');
  const threshold=Math.max(.05,Math.min(.95,Number(parameters.confidence)||.5)),queries=scores.dims[1],objects=[];
  for(let i=0;i<queries;i++){
   const confidence=scores.data[i],label=Number(labels.data[i]);if(confidence<threshold||label!==0)continue;
   const [bx1,by1,bx2,by2]=boxes.data.subarray(i*4,i*4+4),x1=Math.max(0,bx1/size*width),y1=Math.max(0,by1/size*height),x2=Math.min(width,bx2/size*width),y2=Math.min(height,by2/size*height);
   if(![x1,y1,x2,y2].every(Number.isFinite)||x2<=x1||y2<=y1)continue;
   const area=(x2-x1)*(y2-y1);
   objects.push({id:`ai-${i}`,x:(x1+x2)/2,y:(y1+y2)/2,r:Math.sqrt(area/Math.PI),area,bbox:[x1,y1,x2-x1,y2-y1],contour:[[x1,y1],[x2,y1],[x2,y2],[x1,y2]],source:'auto',confidence,label,needsReview:confidence<.65});
  }
  for(const t of Object.values(output))t.dispose();
  const refined=suppressContainerDetections(objects,parameters.suppressContainers!==false);
  const warnings=refined.objects.length?['AI 검출 결과입니다. 번호와 실제 알약 위치를 직접 확인하세요.']:['AI가 알약을 검출하지 못했습니다. 사진과 신뢰도 기준을 확인하거나 직접 표시하세요.'];
  if(refined.excluded.length)warnings.unshift(`용기·배경으로 의심되는 큰 영역 ${refined.excluded.length}개를 제외했습니다. 실제 알약이 빠졌는지 확인하세요.`);
  self.postMessage({objects:refined.objects,excludedDetections:refined.excluded,processingTimeMs:Math.round(performance.now()-start),detector:{type:'ai-deim',model:modelInfo.model,revision:modelInfo.revision,sha256:modelInfo.sha256,license:modelInfo.license,runtime:'ONNX Runtime Web 1.30.0',parameters:{confidence:threshold,inputSize:size,suppressContainers:parameters.suppressContainers!==false,normalization:'ImageNet mean/std after RGB/255',postprocess:'pill class 0; nested container suppression v1 (optional)'}},quality:null,warnings});
 }catch(e){self.postMessage({error:'AI 분석에 실패했습니다. '+(e.message||String(e))});}
};
