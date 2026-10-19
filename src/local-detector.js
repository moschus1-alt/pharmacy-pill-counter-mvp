import {openModelStore,stored,validateManifest} from './model-store.js';

// Same interface as the server detector; the ordinary counter owns all camera,
// editing, confirmation and dispensing UI. Keep the model alive between frames.
export class LocalPillDetector {
 constructor(){this.worker=null;this.pending=null;this.controller=null;this.ready=false;this.manifest=null;}
 reset(){
  this.worker?.terminate();this.worker=null;this.ready=false;
  const pending=this.pending;this.pending=null;pending?.reject(new DOMException('취소','AbortError'));
 }
 request(message,onProgress,timeoutMs){
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{const pending=this.pending;this.pending=null;this.reset();pending?.reject(Error('인식 준비가 오래 걸려요. 다시 시도해 주세요.'));},timeoutMs);
   this.pending={onProgress,resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}};
   this.worker.postMessage(message);
  });
 }
 async prepare(signal,onProgress){
  if(this.ready)return;
  onProgress?.('처음 사용할 모델을 준비하고 있어요…');
  if(!this.manifest){
   try{const response=await fetch('/model-download/manifest.json',{cache:'no-cache',signal});if(!response.ok)throw Error('모델 정보를 받지 못했어요. 인터넷 연결을 확인해 주세요.');this.manifest=validateManifest(await response.json());}
   catch(error){signal.throwIfAborted();const db=await openModelStore();try{const saved=await stored(db,'ready');if(!saved)throw error;this.manifest=validateManifest(saved);}finally{db.close();}}
  }
  signal.throwIfAborted();
  this.worker=new Worker('/src/local-worker.js');
  this.worker.onmessage=({data})=>{
   if(data.type==='status')this.pending?.onProgress?.(data.text);
   else if(data.type==='progress')this.pending?.onProgress?.(`인식 모델 준비 ${Math.round(data.done/data.total*100)}% · 한 번 저장하면 다시 사용해요`);
   else{const pending=this.pending;this.pending=null;if(data.type==='error')pending?.reject(Error(data.message));else pending?.resolve(data);}
  };
  this.worker.onerror=event=>{event.preventDefault();const pending=this.pending;this.pending=null;pending?.reject(Error('휴대폰 인식 엔진을 실행하지 못했어요. 브라우저를 최신 버전으로 업데이트해 주세요.'));};
  await this.request({type:'init',backend:'wasm',manifest:this.manifest},onProgress,180000);
  signal.throwIfAborted();this.ready=true;
 }
 async analyze(imageData,parameters={},onProgress){
  this.cancel();const controller=new AbortController();this.controller=controller;
  const {signal}=controller,started=performance.now();
  try{
   await this.prepare(signal,onProgress);signal.throwIfAborted();
   // Preserve the photo/live encoding used by the existing server counter.
   const canvas=document.createElement('canvas');canvas.width=imageData.width;canvas.height=imageData.height;canvas.getContext('2d').putImageData(imageData,0,0);
   const encode=(type,quality)=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('사진을 준비하지 못했어요.')),type,quality));
   let photo=await encode(parameters.jpeg?'image/jpeg':'image/png',.94);
   if(photo.size>4000000)photo=await encode('image/jpeg',.9);
   if(photo.size>4000000)throw Error('더 작은 사진으로 다시 시도해 주세요.');
   const bitmap=await createImageBitmap(photo),context=canvas.getContext('2d');context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0);bitmap.close();signal.throwIfAborted();
   const result=await this.request({type:'run',image:context.getImageData(0,0,canvas.width,canvas.height),confidence:parameters.confidence??.5},onProgress,parameters.timeoutMs??45000);
   signal.throwIfAborted();
   return {objects:result.objects,processingTimeMs:Math.round(performance.now()-started),quality:null,warnings:[],detector:{type:'on-device',runtime:'LiteRT CPU',sha256:this.manifest.sha256},timings:result.timings};
  }catch(error){if(this.controller===controller)this.reset();if(error.name==='AbortError')throw Error('인식을 중지했어요. 다시 세기를 눌러 주세요.');throw error;}
  finally{if(this.controller===controller)this.controller=null;}
 }
 cancel(){if(this.controller){this.controller.abort();this.controller=null;this.reset();}}
 dispose(){this.cancel();this.reset();}
}
