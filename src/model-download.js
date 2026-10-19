import {validateManifest,openModelStore,stored,downloadModel,removeModel} from './model-store.js';
const $=id=>document.getElementById(id),mb=bytes=>(bytes/1024/1024).toFixed(1)+' MB';
let manifest,db,controller,readyBlob;
const message=text=>$('model-status').textContent=text;
function busy(value){$('model-download').disabled=value;$('model-cancel').hidden=!value;$('model-save').disabled=value;$('model-remove').disabled=value;}
function downloaded(){
  $('model-cached').textContent='저장됨';$('model-download').textContent='저장한 모델 확인';$('model-save').hidden=false;$('model-remove').hidden=false;
}
async function receive(){
  controller=new AbortController();busy(true);$('model-progress').value=0;$('model-progress').hidden=false;message('모델을 받고 있어요.');
  try{
    readyBlob=await downloadModel(manifest,db,{signal:controller.signal,onProgress:(loaded,total)=>{$('model-progress').value=loaded/total*100;message(`${Math.floor(loaded/total*100)}% · ${mb(loaded)} / ${mb(total)}`);}});
    downloaded();message('모델을 이 기기에 저장했어요. 파일로도 저장할 수 있어요.');
  }catch(error){readyBlob=null;$('model-cached').textContent='다운로드 미완료';$('model-save').hidden=true;message(error.name==='AbortError'?'다운로드를 중지했어요. 다시 누르면 이어서 받아요.':error.message);}
  finally{busy(false);controller=null;}
}
$('model-download').onclick=receive;
$('model-cancel').onclick=()=>controller?.abort();
$('model-save').onclick=async()=>{
  if(!readyBlob){await receive();if(!readyBlob)return;}
  const url=URL.createObjectURL(readyBlob),link=document.createElement('a');link.href=url;link.download=manifest.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);message('파일 저장을 시작했어요. 브라우저 다운로드 목록에서 확인해 주세요.');
};
$('model-remove').onclick=async()=>{
  busy(true);
  try{await removeModel(db,manifest);readyBlob=null;$('model-cached').textContent='저장 안 됨';$('model-download').textContent='모델 받기';$('model-save').hidden=true;$('model-remove').hidden=true;$('model-progress').hidden=true;message('이 브라우저에 저장한 모델을 삭제했어요.');}
  catch(error){message(error.message);}finally{busy(false);}
};
window.addEventListener('pagehide',()=>controller?.abort());
try{
  db=await openModelStore();
  let response;
  try{response=await fetch('/model-download/manifest.json',{cache:'no-store'});}catch{}
  manifest=validateManifest(response?.ok?await response.json():await stored(db,'ready'));
  $('model-size').textContent=mb(manifest.bytes);$('model-hash').textContent='SHA-256: '+manifest.sha256;
  const saved=await stored(db,'ready');
  if(saved?.sha256===manifest.sha256){downloaded();message('이 기기에 모델이 저장되어 있어요.');}else{$('model-cached').textContent='저장 안 됨';message('모델 받기를 누르면 다운로드를 시작해요.');}
  busy(false);
}catch(error){message(error.message);$('model-cached').textContent='확인 필요';}
