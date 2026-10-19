export const MODEL_HASH='967308748ace08b219acb3913de40feac92fe71e1864892386b9475923a1275b';
const database='pill-counter-model-v1';
const hex=buffer=>Array.from(new Uint8Array(buffer),byte=>byte.toString(16).padStart(2,'0')).join('');
export async function digest(bytes){return hex(await crypto.subtle.digest('SHA-256',bytes));}
export function validateManifest(value,expectedHash=MODEL_HASH){
  if(value?.schemaVersion!==1||value.sha256!==expectedHash||value.version!==expectedHash.slice(0,16)||value.filename!=='pill-counter-model.tflite'||!Number.isSafeInteger(value.bytes)||value.bytes<=0||value.bytes>512*1024*1024||!Array.isArray(value.parts)||!value.parts.length||value.parts.length>128)throw Error('모델 정보를 확인하지 못했어요. 새로고침해 주세요.');
  let total=0;
  for(let i=0;i<value.parts.length;i++){
    const part=value.parts[i];
    if(part.url!==`/model-download/${value.version}/part-${String(i).padStart(3,'0')}.bin`||!Number.isSafeInteger(part.bytes)||part.bytes<=0||part.bytes>4*1024*1024||!/^[a-f0-9]{64}$/.test(part.sha256))throw Error('모델 파일 정보가 올바르지 않아요.');
    total+=part.bytes;
  }
  if(total!==value.bytes)throw Error('모델 파일 크기를 확인하지 못했어요.');
  return value;
}
export async function openModelStore(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(database,1);
    request.onupgradeneeded=()=>request.result.createObjectStore('files');
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(Error('기기 저장 공간을 사용할 수 없어요. 브라우저 설정을 확인해 주세요.'));
    request.onblocked=()=>reject(Error('다른 알약 카운터 창을 닫고 다시 시도해 주세요.'));
  });
}
export function stored(db,key,operation='get',value){
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction('files',operation==='get'?'readonly':'readwrite'),store=transaction.objectStore('files');
    const request=operation==='put'?store.put(value,key):store[operation](key);
    transaction.oncomplete=()=>resolve(request.result);
    transaction.onerror=transaction.onabort=()=>reject(Error('모델 저장에 실패했어요. 기기 여유 공간을 확인해 주세요.'));
  });
}
export async function downloadModel(manifest,db,{signal,onProgress=()=>{},fetchFile=fetch}={}){
  const chunks=[];let completed=0;
  // Clear the completion marker before checking cached chunks. Partial downloads
  // can resume, but are never shown as a complete model.
  await stored(db,'ready','delete');
  for(let index=0;index<manifest.parts.length;index++){
    signal?.throwIfAborted();
    const part=manifest.parts[index],key=`${manifest.sha256}:${index}`;
    let buffer=await stored(db,key);
    if(!(buffer instanceof ArrayBuffer)||buffer.byteLength!==part.bytes||await digest(buffer)!==part.sha256){
      await stored(db,key,'delete');
      const response=await fetchFile(part.url,{signal,cache:'no-cache'});
      if(!response.ok)throw Error('모델을 받지 못했어요. 다시 누르면 이어서 받아요.');
      const reader=response.body?.getReader();let received=0;const data=new Uint8Array(part.bytes);
      if(!reader)throw Error('브라우저에서 다운로드를 시작하지 못했어요.');
      try{
        while(true){const {done,value}=await reader.read();if(done)break;received+=value.byteLength;if(received>part.bytes)throw Error('모델 파일 크기가 올바르지 않아요.');data.set(value,received-value.byteLength);onProgress(completed+received,manifest.bytes);}
      }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      buffer=data.buffer;
      if(received!==part.bytes||await digest(buffer)!==part.sha256)throw Error('받은 파일이 완전하지 않아요. 다시 눌러 주세요.');
      await stored(db,key,'put',buffer);
    }
    chunks.push(buffer);completed+=part.bytes;onProgress(completed,manifest.bytes);
  }
  signal?.throwIfAborted();
  const blob=new Blob(chunks,{type:'application/octet-stream'});
  if(await digest(await blob.arrayBuffer())!==manifest.sha256)throw Error('모델 검증에 실패했어요. 다시 받아 주세요.');
  signal?.throwIfAborted();
  await stored(db,'ready','put',manifest);
  return blob;
}
export async function removeModel(db,manifest){
  await stored(db,'ready','delete');
  for(let i=0;i<manifest.parts.length;i++)await stored(db,`${manifest.sha256}:${i}`,'delete');
}
