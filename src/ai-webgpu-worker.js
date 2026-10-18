import * as ort from '../vendor/ort/ort.webgpu.bundle.min.mjs';
import {suppressContainerDetections} from './ai-postprocess.js';
import {loadVerifiedModel} from './model-cache.js';
// GPU-only execution. Unsupported ONNX operators must produce a visible error, not CPU fallback.
ort.env.wasm.numThreads=1;
ort.env.wasm.wasmPaths=new URL('../vendor/ort/',import.meta.url).href;
let session,modelInfo,sessionLoadInfo;
async function initialize(){
 if(session)return {...sessionLoadInfo,modelLoadTimeMs:0,sessionInitTimeMs:0,sessionReused:true};
 if(!navigator.gpu)throw Error('이 브라우저의 작업 스레드에서 WebGPU를 사용할 수 없습니다.');
 const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
 if(!adapter)throw Error('사용할 수 있는 GPU 어댑터가 없습니다.');
 const {model,cacheHit,modelLoadTimeMs,persistentStorage}=await loadVerifiedModel(status=>self.postMessage(status));
 modelInfo=await fetch(new URL('../models/model-info.json',import.meta.url)).then(r=>{if(!r.ok)throw Error('모델 정보를 읽을 수 없습니다.');return r.json();});
 self.postMessage({phase:'session',progress:'WebGPU 전용 모델 세션 초기화 중입니다.'});
 const initStarted=performance.now();
 session=await ort.InferenceSession.create(model,{executionProviders:['webgpu'],graphOptimizationLevel:'all'});
 sessionLoadInfo={modelLoadTimeMs,sessionInitTimeMs:Math.round(performance.now()-initStarted),cacheHit,persistentStorage,sessionReused:false};
 return sessionLoadInfo;
}
self.onmessage=async({data:{imageData,parameters={}}})=>{
 try{
  const loadTimes=await initialize();self.postMessage({phase:'infer',progress:'GPU로 알약 위치를 추론하고 있습니다.'});
  const start=performance.now(),size=640;
  const width=Number(parameters.originalWidth)||imageData.width,height=Number(parameters.originalHeight)||imageData.height;
  // Mobile UI already sent 640x640 pixels; older/benchmark callers use the original path.
  let rgba;
  if(imageData.width===size&&imageData.height===size){
   rgba=imageData.data;
  }else{
   const original=new OffscreenCanvas(imageData.width,imageData.height);original.getContext('2d').putImageData(imageData,0,0);
   const resized=new OffscreenCanvas(size,size),ctx=resized.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='low';ctx.drawImage(original,0,0,size,size);
   rgba=ctx.getImageData(0,0,size,size).data;
  }
  const plane=size*size,tensor=new Float32Array(plane*3);
  for(let i=0;i<plane;i++){tensor[i]=(rgba[i*4]/255-.485)/.229;tensor[plane+i]=(rgba[i*4+1]/255-.456)/.224;tensor[plane*2+i]=(rgba[i*4+2]/255-.406)/.225;}
  const input=new ort.Tensor('float32',tensor,[1,3,size,size]);
  const inferStart=performance.now();
  let output;try{output=await session.run({image:input});}finally{input.dispose();}
  const inferenceTimeMs=Math.round(performance.now()-inferStart);
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
  self.postMessage({objects:refined.objects,excludedDetections:refined.excluded,processingTimeMs:Math.round(performance.now()-start),inferenceTimeMs,...loadTimes,detector:{type:'ai-deim',model:modelInfo.model,revision:modelInfo.revision,sha256:modelInfo.sha256,license:modelInfo.license,runtime:'ONNX Runtime Web 1.30.0 (WebGPU only)',parameters:{confidence:threshold,inputSize:size,wasmThreads:ort.env.wasm.numThreads,suppressContainers:parameters.suppressContainers!==false,normalization:'ImageNet mean/std after RGB/255',postprocess:'pill class 0; nested container suppression v1 (optional)'}},quality:null,warnings});
 }catch(e){self.postMessage({error:'AI 분석에 실패했습니다. '+(e.message||String(e))});}
};
