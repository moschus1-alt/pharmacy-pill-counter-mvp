export class AIDetector {
 constructor(){this.worker=null;this.workerThreads=0;this.pending=null;}
 analyze(imageData,parameters={},onProgress){
  this.cancel();
  const requested=Number(parameters.wasmThreads)===2;
  const supported=self.crossOriginIsolated&&typeof SharedArrayBuffer!=='undefined'&&(navigator.hardwareConcurrency||2)>=2;
  const threads=requested&&supported?2:1;
  if(requested&&!supported)onProgress?.('멀티스레드가 지원되지 않아 1스레드로 인식합니다.');
  return (async()=>{
   try{return await this.attempt(imageData,{...parameters,wasmThreads:threads},onProgress,threads);}
   catch(error){
    if(threads!==2||error.name==='AbortError')throw error;
    onProgress?.('2스레드 응답 실패 · 1스레드로 자동 재시도합니다.');
    const result=await this.attempt(imageData,{...parameters,wasmThreads:1},onProgress,1);
    result.fallbackFromThreads=2;
    return result;
   }
  })();
 }
 attempt(imageData,parameters,onProgress,threads){
  return new Promise((resolve,reject)=>{
   if(this.worker&&this.workerThreads!==threads){this.worker.terminate();this.worker=null;}
   const worker=this.worker??=new Worker(new URL('./ai-worker.js',import.meta.url),{type:'module'});
   this.workerThreads=threads;
   let finished=false,stageTimer=null,totalTimer=null;
   const finish=(error,result)=>{
    if(finished)return;
    finished=true;clearTimeout(totalTimer);clearTimeout(stageTimer);
    this.pending=null;
    if(error){
     worker.terminate();if(this.worker===worker){this.worker=null;this.workerThreads=0;}
     reject(error);
    }else resolve(result);
   };
   const watchPhase=phase=>{
    clearTimeout(stageTimer);stageTimer=null;
    if(threads!==2)return;
    // Only time out CPU initialization/inference, never an ordinary model-part download.
    if(phase==='session'||phase==='infer'){
     stageTimer=setTimeout(()=>finish(new Error(phase==='session'?'2스레드 모델 초기화 시간 초과':'2스레드 추론 시간 초과')),90000);
    }
   };
   totalTimer=setTimeout(()=>finish(new Error('AI 분석 제한 시간 5분을 초과했습니다.')),300000);
   this.pending=()=>finish(Object.assign(new Error('분석이 취소되었습니다.'),{name:'AbortError'}));
   worker.onerror=()=>finish(new Error('AI 실행 파일을 읽지 못했습니다. 브라우저 호환성을 확인하세요.'));
   worker.onmessage=({data})=>{
    if(finished)return;
    if(data.progress){watchPhase(data.phase);onProgress?.(data.progress);return;}
    data.error?finish(new Error(data.error)):finish(null,data);
   };
   // Keep the caller's 1.6MB input intact so it can be transferred to the fallback worker.
   if(threads===2)worker.postMessage({imageData,parameters});
   else worker.postMessage({imageData,parameters},[imageData.data.buffer]);
  });
 }
 cancel(){this.pending?.();}
 dispose(){this.cancel();this.worker?.terminate();this.worker=null;this.workerThreads=0;}
}
