export class PillDetector {
 constructor(){this.controller=null;}
 async analyze(imageData,parameters={},onProgress){
  this.cancel();
  const controller=new AbortController();this.controller=controller;
   const timer=setTimeout(()=>controller.abort(),parameters.timeoutMs??45000),started=performance.now();
  try{
   onProgress?.('사진을 준비하고 있습니다…');
   const canvas=document.createElement('canvas');canvas.width=imageData.width;canvas.height=imageData.height;
   canvas.getContext('2d').putImageData(imageData,0,0);
   const encode=(type,quality)=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('사진을 변환하지 못했습니다.')),type,quality));
   let photo=parameters.jpeg?await encode('image/jpeg',.94):await encode('image/png');
   if(photo.size>4000000)photo=await encode('image/jpeg',.9);
   if(photo.size>4000000)throw Error('사진 크기가 너무 큽니다. 작은 사진으로 다시 시도해 주세요.');
   if(controller.signal.aborted)throw new DOMException('취소','AbortError');
   onProgress?.('사진 속 알약을 찾고 있어요…');
   let response;
   for(let attempt=0;attempt<3;attempt++){
    response=await fetch('/api/analyze',{method:'POST',signal:controller.signal,headers:{'Content-Type':photo.type,'X-Confidence':String(parameters.confidence??.5)},body:photo});
    if(response.status!==429||parameters.jpeg||attempt===2)break;
    await response.body?.cancel();
    await new Promise((resolve,reject)=>{
     const aborted=()=>{clearTimeout(wait);reject(new DOMException('취소','AbortError'));};
     const wait=setTimeout(()=>{controller.signal.removeEventListener('abort',aborted);resolve();},800*(attempt+1));
     if(controller.signal.aborted)aborted();else controller.signal.addEventListener('abort',aborted,{once:true});
    });
   }
   const result=await response.json().catch(()=>{throw Error(`분석 서버 응답 오류 (${response.status})`);});
   if(!response.ok){const error=Error(result.error||`분석 서버 오류 (${response.status})`);error.status=response.status;throw error;}
   result.serverProcessingTimeMs=result.processingTimeMs;
   result.processingTimeMs=Math.round(performance.now()-started);
   return result;
  }catch(error){
   if(error.name==='AbortError')throw Error('분석이 취소되었거나 응답 시간이 초과되었습니다.');
   throw error;
  }finally{clearTimeout(timer);if(this.controller===controller)this.controller=null;}
 }
 cancel(){this.controller?.abort();this.controller=null;}
 dispose(){this.cancel();}
}
