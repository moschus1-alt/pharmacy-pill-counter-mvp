export class AIDetector {
 constructor(){this.worker=null;this.pending=null;}
 analyze(imageData,parameters,onProgress){
  this.cancel();
  return new Promise((resolve,reject)=>{
   const worker=this.worker??=new Worker(new URL('./ai-worker.js',import.meta.url),{type:'module'});
   let finished=false;
   const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);this.pending=null;if(error){worker.terminate();if(this.worker===worker)this.worker=null;reject(error);}else resolve(result);};
   const timer=setTimeout(()=>finish(new Error('AI 분석 시간이 초과됐습니다. 사진을 줄이거나 다시 시도하세요.')),180000);
   this.pending=()=>finish(new Error('분석이 취소되었습니다.'));
   worker.onerror=()=>finish(new Error('AI 실행 파일을 읽지 못했습니다. 로컬 서버와 모델 파일을 확인하세요.'));
   worker.onmessage=({data})=>{if(data.progress){onProgress?.(data.progress);return;}data.error?finish(new Error(data.error)):finish(null,data);};
   worker.postMessage({imageData,parameters},[imageData.data.buffer]);
  });
 }
 cancel(){this.pending?.();}
 dispose(){this.cancel();this.worker?.terminate();this.worker=null;}
}
