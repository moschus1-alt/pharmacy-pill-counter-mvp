// The pill model is verified once and stored in the origin-private filesystem (OPFS).
// Every worker on the SAME HTTPS origin shares this cache. Other hostnames/browser profiles do not.
const ROOT=new URL('../models/',import.meta.url);
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const readJSON=async url=>{
 const response=await fetch(url);
 if(!response.ok)throw Error('모델 정보 또는 목록을 읽을 수 없습니다.');
 return response.json();
};
const notify=(progress,phase='cache')=>({progress,phase});
export async function loadVerifiedModel(progress=()=>{}){
 const manifest=await readJSON(new URL('parts.json',ROOT));
 if(!manifest.sha256||!Number.isSafeInteger(manifest.bytes)||manifest.bytes<1||!Array.isArray(manifest.parts))
  throw Error('AI 모델 목록 정보가 올바르지 않습니다.');
 const basename='deim-'+manifest.sha256;
 const fileName=basename+'.onnx';
 const readyName=basename+'.verified.json';
 const job=async()=>{
  let root=null;
  try{
   if(navigator.storage?.getDirectory)root=await navigator.storage.getDirectory();
  }catch(e){progress(notify('브라우저 저장 공간을 사용할 수 없습니다. 이번 실행은 다운로드로 진행합니다.'));}
  if(root){
   try{
    const ready=JSON.parse(await (await (await root.getFileHandle(readyName)).getFile()).text());
    const stored=await (await root.getFileHandle(fileName)).getFile();
    if(ready.sha256===manifest.sha256&&ready.bytes===manifest.bytes&&ready.partsVerified===manifest.parts.length&&stored.size===manifest.bytes){
     progress(notify('휴대폰에 저장된 AI 모델 재사용 중 (211MB 다운로드 없음)'));
     const started=performance.now();
     const model=new Uint8Array(await stored.arrayBuffer());
     return {model,cacheHit:true,modelLoadTimeMs:Math.round(performance.now()-started),persistentStorage:true};
    }
   }catch(e){/* No complete validated local model yet. */}
  }else progress(notify('이 브라우저에서는 전용 모델 저장소를 지원하지 않습니다. 다운로드가 필요합니다.'));
  const started=performance.now();
  const model=new Uint8Array(manifest.bytes);
  let offset=0,writer=null;
  if(root){
   try{
    // A ready marker is written only after every part passes its SHA-256 check.
    try{await root.removeEntry(readyName);}catch(e){if(e.name!=='NotFoundError')throw e;}
    writer=await (await root.getFileHandle(fileName,{create:true})).createWritable();
   }catch(e){
    progress(notify('저장 공간이 부족하거나 제한되었습니다. 다운로드 후 이번 실행에만 사용합니다.'));
   }
  }
  try{
   for(let i=0;i<manifest.parts.length;i++){
    const part=manifest.parts[i];
    progress(notify('AI 모델 최초 다운로드 '+Math.round(offset/manifest.bytes*100)+'% · 전체 약 211MB','download'));
    const response=await fetch(new URL(part.file,ROOT));
    if(!response.ok)throw Error('모델 다운로드에 실패했습니다. Wi-Fi 연결을 확인해 주세요.');
    const bytes=new Uint8Array(await response.arrayBuffer());
    if(bytes.length!==part.bytes||offset+bytes.length>manifest.bytes)
     throw Error('모델 파일의 크기가 올바르지 않습니다.');
    const hash=hex(await crypto.subtle.digest('SHA-256',bytes));
    if(hash!==part.sha256)throw Error('모델 파일 무결성 검증에 실패했습니다.');
    model.set(bytes,offset);offset+=bytes.length;
    if(writer){
     try{await writer.write(bytes);}catch(e){
      try{await writer.abort();}catch{}
      writer=null;
      progress(notify('모델 저장에 실패했습니다. 인식은 계속하지만 다음 실행 때 다시 다운로드할 수 있습니다.'));
     }
    }
   }
   if(offset!==manifest.bytes)throw Error('모델 전체 크기가 일치하지 않습니다.');
   let saved=false;
   if(writer&&root){
    try{
     await writer.close();writer=null;
     const meta=await (await root.getFileHandle(readyName,{create:true})).createWritable();
     await meta.write(JSON.stringify({sha256:manifest.sha256,bytes:manifest.bytes,partsVerified:manifest.parts.length}));
     await meta.close();
     saved=true;
     progress(notify('모델을 휴대폰에 저장했습니다. 같은 주소에서 다음부터 재사용합니다.'));
    }catch(e){
     progress(notify('모델 저장을 완료하지 못했습니다. 다음 실행 때 다시 다운로드할 수 있습니다.'));
    }
   }
   return {model,cacheHit:false,modelLoadTimeMs:Math.round(performance.now()-started),persistentStorage:saved};
  }catch(e){
   if(writer){try{await writer.abort();}catch{}}
   if(root){try{await root.removeEntry(readyName);}catch{}}
   throw e;
  }
 };
 if(navigator.locks?.request)return navigator.locks.request('pill-model-'+manifest.sha256,job);
 return job();
}
