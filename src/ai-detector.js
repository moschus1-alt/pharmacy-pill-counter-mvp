// Keep WebGPU and WASM in separate workers. If GPU initialization or inference fails,
// release the GPU worker before trying the proven CPU implementation.
export class AIDetector {
 constructor(){this.worker=null;this.workerMode=null;this.pending=null;}
 analyze(imageData,parameters={},onProgress){
  this.cancel();
  const wantsGPU=parameters.runtime==='webgpu';
  const gpuAvailable=typeof navigator!=='undefined'&&Boolean(navigator.gpu);
  return (async()=>{
   let fallbackReason='';
   if(wantsGPU&&gpuAvailable){
    try{return await this.attempt(imageData,parameters,onProgress,'webgpu');}
    catch(error){
     if(error.name==='AbortError')throw error;
     fallbackReason=error.message||'GPU 실행 오류';
     onProgress?.('GPU 실행 실패 · 기존 CPU 엔진으로 자동 재시도합니다.');
    }
   }else if(wantsGPU){
    fallbackReason='이 브라우저에서 WebGPU가 제공되지 않습니다.';
    onProgress?.('WebGPU 미지원 · CPU로 인식합니다.');
   }
   const result=await this.attempt(imageData,parameters,onProgress,'wasm');
   if(fallbackReason)result.gpuFallbackReason=fallbackReason;
   return result;
  })();
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
   totalTimer=setTimeout(()=>finish(new Error('AI 분석 시간이 초과됐습니다.')),mode==='webgpu'?300000:180000);
   const watch=phase=>{
    clearTimeout(watchdog);watchdog=null;
    if(mode==='webgpu'&&(phase==='session'||phase==='infer'))
     watchdog=setTimeout(()=>finish(new Error(phase==='session'?'GPU 모델 초기화 제한 시간 초과':'GPU 추론 제한 시간 초과')),90000);
   };
   this.pending=()=>finish(Object.assign(new Error('분석이 취소되었습니다.'),{name:'AbortError'}));
   worker.onerror=()=>finish(new Error(mode==='webgpu'?'GPU 실행 모듈을 불러오지 못했습니다.':'AI 실행 파일을 읽지 못했습니다.'));
   worker.onmessage=({data})=>{
    if(finished)return;
    if(data.progress){if(data.phase)watch(data.phase);onProgress?.(data.progress);return;}
    data.error?finish(new Error(data.error)):finish(null,data);
   };
   // GPU cannot detach the caller buffer: the fallback CPU run needs the same image.
   if(mode==='webgpu')worker.postMessage({imageData,parameters});
   else worker.postMessage({imageData,parameters},[imageData.data.buffer]);
  });
 }
 cancel(){this.pending?.();}
 dispose(){this.cancel();this.worker?.terminate();this.worker=null;this.workerMode=null;}
}
