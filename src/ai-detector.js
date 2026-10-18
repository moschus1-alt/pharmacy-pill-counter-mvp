// GPU is diagnostic-only: never silently switch execution providers.
// Users can explicitly select the CPU reference mode in the interface.
export class AIDetector {
 constructor(){this.worker=null;this.workerMode=null;this.pending=null;}
 analyze(imageData,parameters={},onProgress){
  this.cancel();
  const mode=parameters.runtime==='webgpu'?'webgpu':'wasm';
  if(mode==='webgpu'&&!navigator.gpu)
   return Promise.reject(new Error('이 브라우저에서 WebGPU가 지원되지 않습니다. GPU 실행을 시도하지 않았습니다.'));
  return this.attempt(imageData,parameters,onProgress,mode);
 }
 attempt(imageData,parameters,onProgress,mode){
  return new Promise((resolve,reject)=>{
   if(this.worker&&this.workerMode!==mode){this.worker.terminate();this.worker=null;}
   const worker=this.worker??=new Worker(new URL(mode==='webgpu'?'./ai-webgpu-worker.js':'./ai-worker.js',import.meta.url),{type:'module'});
   this.workerMode=mode;
   let finished=false,watchdog=null,totalTimer=null;
   const finish=(error,result)=>{
    if(finished)return;
    finished=true;clearTimeout(watchdog);clearTimeout(totalTimer);this.pending=null;
    if(error){
     worker.terminate();if(this.worker===worker){this.worker=null;this.workerMode=null;}
     reject(error);
    }else resolve(result);
   };
   totalTimer=setTimeout(()=>finish(new Error(mode==='webgpu'?'GPU 분석 전체 제한 시간 초과':'CPU 분석 전체 제한 시간 초과')),300000);
   const watch=phase=>{
    clearTimeout(watchdog);watchdog=null;
    if(mode==='webgpu'&&(phase==='session'||phase==='infer'))
     watchdog=setTimeout(()=>finish(new Error(phase==='session'?'GPU 모델 초기화 60초 시간 초과':'GPU 추론 60초 시간 초과')),60000);
   };
   this.pending=()=>finish(Object.assign(new Error('분석이 취소되었습니다.'),{name:'AbortError'}));
   worker.onerror=event=>{
    const detail=event.message&&event.message!=='Script error.'?event.message:'GPU/CPU 작업 스레드 스크립트 오류';
    finish(new Error((mode==='webgpu'?'GPU':'CPU')+' 실행 모듈 오류: '+detail));
   };
   worker.onmessageerror=()=>finish(new Error('작업 스레드 메시지 처리에 실패했습니다.'));
   worker.onmessage=({data})=>{
    if(finished)return;
    if(data.progress){if(data.phase)watch(data.phase);onProgress?.(data.progress);return;}
    data.error?finish(new Error(data.error)):finish(null,data);
   };
   worker.postMessage({imageData,parameters},[imageData.data.buffer]);
  });
 }
 cancel(){this.pending?.();}
 dispose(){this.cancel();this.worker?.terminate();this.worker=null;this.workerMode=null;}
}
