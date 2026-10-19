import {openModelStore,stored,validateManifest} from './model-store.js';
import {compareResults} from './local-inference.js';
const $=id=>document.getElementById(id),ms=value=>`${(value/1000).toFixed(2)}초`;
let worker=null,pending=null,ready=false,busy=false,controller=null,photo=null,manifest=null,initMs=0,engineLabel='CPU · WASM',operation=0;
function status(text,error=false){$('status').textContent=text;$('status').dataset.error=String(error);}
function controls(){
 for(const id of ['prepare','backend','choose','camera','sample'])$(id).disabled=busy;
 $('run-local').disabled=busy||!photo;$('compare').disabled=busy||!photo;$('cancel').hidden=!busy;
 $('engine-state').textContent=ready?'준비 완료':'준비 전';$('prepare').textContent=ready?'엔진 준비 완료':'모델 받고 준비하기';
}
function resetWorker(){worker?.terminate();worker=null;ready=false;if(pending){pending.reject(new DOMException('중지','AbortError'));pending=null;}}
function request(message){return new Promise((resolve,reject)=>{pending={resolve,reject};worker.postMessage(message);});}
async function ensureEngine(signal){
 if(ready)return;
 if(!manifest){
  try{const response=await fetch('/model-download/manifest.json',{cache:'no-cache',signal});if(!response.ok)throw Error('모델 정보를 받지 못했어요.');manifest=validateManifest(await response.json());}
  catch(error){signal.throwIfAborted();const db=await openModelStore();try{const saved=await stored(db,'ready');if(!saved)throw error;manifest=validateManifest(saved);}finally{db.close();}}
 }
 signal.throwIfAborted();
 resetWorker();worker=new Worker('/src/local-worker.js');
 worker.onmessage=({data})=>{
  if(data.type==='status')status(data.text);
  else if(data.type==='progress'){$('progress').hidden=false;$('progress').value=data.done/data.total*100;status(`모델 확인·저장 중 ${Math.round(data.done/data.total*100)}%`);}
  else{const call=pending;pending=null;if(data.type==='error')call?.reject(Error(data.message));else call?.resolve(data);}
 };
 worker.onerror=event=>{event.preventDefault();pending?.reject(Error(event.message||'인식 엔진을 실행하지 못했어요.'));pending=null;};
 const info=await request({type:'init',manifest,backend:$('backend').value});signal.throwIfAborted();
 ready=true;initMs=info.initMs;engineLabel=info.backend==='wasm'?'CPU · WASM':info.fullyAccelerated?'GPU · FP32':'GPU 요청 · CPU 혼합/대체';
 $('model-info').textContent=`모델 ${(manifest.bytes/1048576).toFixed(1)}MB 저장됨 · 준비 ${ms(initMs)} · ${engineLabel}`;
 $('progress').hidden=true;controls();
}
async function action(task){
 if(busy)return;busy=true;const id=++operation,active=new AbortController();controller=active;controls();status('준비하고 있어요…');
 try{await task(active.signal);}
 catch(error){if(id!==operation)return;resetWorker();status(error.name==='AbortError'?'중지했어요. 다시 시작할 수 있어요.':`${error.message} 다시 시도하거나 실행 방식을 CPU로 바꿔 주세요.`,error.name!=='AbortError');}
 finally{if(id===operation){busy=false;controller=null;$('progress').hidden=true;controls();}}
}
function clearResults(){$('results').hidden=true;$('server-card').hidden=true;$('comparison').hidden=true;$('local-count').textContent='—';$('server-count').textContent='—';}
const encode=(canvas,type='image/png',quality)=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('사진 변환에 실패했어요.')),type,quality));
async function setPhoto(blob,signal){
 if(blob.size>25*1024*1024)throw Error('25MB 이하의 사진을 골라 주세요.');
 let bitmap=await createImageBitmap(blob);signal.throwIfAborted();
 const ratio=Math.min(1,2048/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
 const context=canvas.getContext('2d',{willReadFrequently:true});context.fillStyle='#000';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
 // Both engines receive this canonical encoded photo. Decode it again locally
 // if JPEG compression is necessary, so comparison does not use pre-JPEG pixels.
 let encoded=await encode(canvas);if(encoded.size>4000000)encoded=await encode(canvas,'image/jpeg',.9);
 if(encoded.size>4000000)throw Error('사진 크기가 커요. 더 작은 사진을 골라 주세요.');
 bitmap=await createImageBitmap(encoded);context.drawImage(bitmap,0,0);bitmap.close();signal.throwIfAborted();
 photo={blob:encoded,image:context.getImageData(0,0,canvas.width,canvas.height)};
 const preview=$('preview');preview.width=canvas.width;preview.height=canvas.height;preview.getContext('2d').drawImage(canvas,0,0);
 $('preview-wrap').hidden=false;$('photo-info').textContent=`${canvas.width} × ${canvas.height} · ${encoded.type==='image/png'?'PNG':'JPEG'}`;
 clearResults();status('사진 준비 완료. 기기에서 인식하거나 서버와 비교해 보세요.');
}
function draw(id,objects){const canvas=$(id),{width,height}=photo.image;canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.putImageData(photo.image,0,0);const radius=Math.max(12,width/32);ctx.font=`bold ${radius}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';objects.forEach((o,i)=>{ctx.strokeStyle='#08bd9a';ctx.lineWidth=Math.max(1,width/500);ctx.strokeRect(...o.bbox);ctx.fillStyle='#087761';ctx.beginPath();ctx.arc(o.x,o.y,radius,0,Math.PI*2);ctx.fill();ctx.fillStyle='#fff';ctx.fillText(String(i+1),o.x,o.y);});}
function details(id,rows){$(id).replaceChildren(...rows.map(([label,value])=>{const div=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;div.append(dt,dd);return div;}));}
async function runLocal(signal){
 await ensureEngine(signal);signal.throwIfAborted();const started=performance.now();
 const result=await request({type:'run',image:photo.image});signal.throwIfAborted();result.elapsedMs=performance.now()-started;
 $('results').hidden=false;$('local-count').textContent=result.objects.length;$('local-time').textContent=`인식 ${ms(result.elapsedMs)}`;
 details('local-detail',[['실행',engineLabel],['전처리',ms(result.timings.preprocessMs)],['모델 실행',ms(result.timings.inferenceMs)],['후처리',ms(result.timings.postprocessMs)],['최초 엔진 준비 (별도)',ms(initMs)]]);draw('local-canvas',result.objects);return result;
}
async function runServer(signal){
 status('같은 사진으로 서버 결과를 확인하고 있어요…');const started=performance.now(),timeout=new AbortController();const timer=setTimeout(()=>timeout.abort(),120000);const abort=()=>timeout.abort();signal.addEventListener('abort',abort,{once:true});
 try{
  signal.throwIfAborted();
  const response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':photo.blob.type,'X-Confidence':'.5'},body:photo.blob,signal:timeout.signal});
  const result=await response.json();if(!response.ok)throw Error(result.error||`서버 오류 (${response.status})`);
  if(!Array.isArray(result.objects))throw Error('서버 결과를 읽지 못했어요.');signal.throwIfAborted();result.elapsedMs=performance.now()-started;
  $('server-card').hidden=false;$('server-count').textContent=result.objects.length;$('server-time').textContent=`응답 ${ms(result.elapsedMs)}`;
  details('server-detail',[['분석 처리',ms(result.processingTimeMs)],['서버 전체 처리',ms(result.serverTotalTimeMs)],['서버 엔진 준비',ms(result.sessionInitTimeMs)],['응답 시간', '통신 포함']]);draw('server-canvas',result.objects);return result;
 }catch(error){if(timeout.signal.aborted&&!signal.aborted)throw Error('서버 응답이 늦어요. 잠시 후 다시 비교해 주세요.');throw error;}
 finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
$('prepare').onclick=()=>action(async signal=>{await ensureEngine(signal);status('엔진 준비 완료. 사진을 골라 테스트하세요.');});
$('run-local').onclick=()=>action(async signal=>{clearResults();await runLocal(signal);status('기기 인식 완료. 사진은 전송하지 않았어요.');});
$('compare').onclick=()=>action(async signal=>{
 clearResults();const local=await runLocal(signal);let server;
 try{server=await runServer(signal);}catch(error){if(signal.aborted)throw error;status(`기기 인식은 완료했어요. 서버 비교: ${error.message}`,true);return;}
 const match=compareResults(local.objects,server.objects),box=$('comparison');box.replaceChildren();box.hidden=false;
 const texts=[`기기 ${local.objects.length}알 · 서버 ${server.objects.length}알`, `위치가 겹치는 알약 ${match.matched}개 · 기기만 ${match.localOnly}개 · 서버만 ${match.serverOnly}개`,match.matched?`박스 좌표 최대 차이 ${match.maxBoxDelta.toFixed(2)}px · 신뢰도 최대 차이 ${(match.maxConfidenceDelta*100).toFixed(3)}%p`:'비교할 검출 위치가 없어요.',`기기 ${ms(local.elapsedMs)} · 서버 응답 ${ms(server.elapsedMs)} (통신 포함)`];
 for(const text of texts){const p=document.createElement('p');p.textContent=text;box.append(p);}status('비교 완료. 사진의 번호와 실제 알약을 함께 확인하세요.');
});
$('cancel').onclick=()=>{operation++;controller?.abort();resetWorker();busy=false;controller=null;$('progress').hidden=true;controls();status('중지했어요. 다시 시작할 수 있어요.');};
$('backend').onchange=()=>{resetWorker();controls();$('model-info').textContent='저장한 모델을 재사용해 선택한 엔진을 준비해요.';};
$('choose').onclick=()=>$('file').click();$('camera').onclick=()=>$('capture').click();
for(const id of ['file','capture'])$(id).onchange=()=>{const file=$(id).files[0];$(id).value='';if(file)action(signal=>setPhoto(file,signal));};
$('sample').onclick=()=>action(async signal=>{const response=await fetch('/examples/mediseg-8-pills.png',{signal});if(!response.ok)throw Error('예제 사진을 받지 못했어요.');await setPhoto(await response.blob(),signal);});
addEventListener('pagehide',()=>{controller?.abort();resetWorker();});controls();
