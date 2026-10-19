import {PillDetector} from './image-detector.js';
import {CAMERA_ASPECT_RATIO,cameraConstraints,captureCameraFrame as captureToFrame} from './camera-frame.js';
import {photoGestures} from './photo-gestures.js';
import {appNavigation} from './app-navigation.js';
import {setupDispensing} from './dispensing.js';
import {detectPcView,detectPcDevice,mountPcView} from './pc-view.js';
const pcView=detectPcView();
document.documentElement.dataset.deviceView=pcView?'pc':'mobile';
document.documentElement.dataset.inputDevice=detectPcDevice()?'pc':'mobile';
document.documentElement.style.setProperty('--camera-aspect',String(CAMERA_ASPECT_RATIO));
const $=id=>document.getElementById(id);
const detector=new PillDetector();
const source=document.createElement('canvas');
const canvas=$('canvas'),ctx=canvas.getContext('2d'),video=$('video');
let loaded=false,analyzed=false,manualEdited=false,busy=false,objects=[],undoStack=[],mode='view',zoom=1,scale=1;
let sequence=0,imageRequest=0,originalFile=null,confirmed=false,saving=false,analysis=null;
let currentTab='photo',stream=null,starting=false,liveSession=0,liveTimer=null,liveAgeTimer=null,liveCount=null,liveAt=0,liveErrors=0;
let captureMode=false,captureStream=null,captureStarting=false,captureGeneration=0,captureNotice='알약을 모두 화면에 담아 주세요.';
let saveGeneration=0,saveURL=null,saveFile=null;
let renderedObjects=null,renderedLength=-1;
let panX=0,panY=0;
let rasterDirty=true;
let dispensingCount=false;
const dispensing=setupDispensing({
 startCounting(){resetPhoto();dispensingCount=true;switchTab('photo');update();},
 cancelCounting(){dispensingCount=false;},
 openDispensing(){switchTab('dispense');}
});
if(pcView)mountPcView();
const clone=()=>structuredClone(objects);
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
function setStatus(text,kind=''){$('status').textContent=text;$('status').className=`status ${kind}`;}
function invalidate(){confirmed=false;$('confirmation').textContent='';}
function update(){
 const live=currentTab==='live';
 const inDispense=currentTab==='dispense';
 const inCapture=captureMode&&!live;
 document.querySelector('.header').hidden=inCapture;document.querySelector('.tabs').hidden=inCapture;document.querySelector('.counter').hidden=inCapture||inDispense;document.querySelector('footer').hidden=inCapture;
 $('photo-tab').classList.toggle('selected',!live&&!inDispense);$('photo-tab').setAttribute('aria-pressed',String(!live&&!inDispense));
 $('live-tab').classList.toggle('selected',live);$('live-tab').setAttribute('aria-pressed',String(live));
 $('dispense-tab').classList.toggle('selected',inDispense);$('dispense-tab').setAttribute('aria-pressed',String(inDispense));
 $('dispense-panel').hidden=!inDispense;
 $('dispense-count-banner').hidden=!dispensingCount||inCapture||inDispense;
 $('photo-panel').hidden=live||inCapture||inDispense;$('capture-panel').hidden=!inCapture;$('live-panel').hidden=!live;
 $('count-label').textContent=live?'최근 화면의 알약':'사진 속 알약';
 $('count').value=live?(liveCount===null?'—':String(liveCount)):(loaded&&(analyzed||manualEdited)?String(objects.length):'—');
 if(live){
  setStatus(starting?'카메라 여는 중':stream?'실시간':liveCount===null?'시작 전':'중지됨',stream?'active':'');
  $('count-meta').textContent=liveCount===null?(starting?'카메라를 연결하고 있어요':stream?'첫 화면을 분석하고 있어요':'카메라 연결을 기다리고 있어요'):(stream?'주기적으로 수량을 갱신해요':'마지막 분석 수량');
 }else{
  setStatus(busy?'분석 중':confirmed?'확인 완료':analyzed?'확인해 주세요':loaded?'분석 필요':'시작 전',confirmed?'active':'');
  $('count-meta').textContent=busy?'잠시만 기다려 주세요':confirmed?'직접 확인한 수량입니다':analyzed?'사진의 번호와 대조해 주세요':loaded?'다시 세기를 눌러 주세요':'사진을 찍거나 선택해 주세요';
 }
 $('dropzone').hidden=!loaded;$('empty').hidden=loaded;$('stage').hidden=!loaded;$('busy').hidden=!busy;
 $('image-tools').hidden=!loaded;$('result-actions').hidden=!loaded;$('home-camera-action').hidden=loaded;
 $('photo-back').hidden=!loaded;$('next-photo-actions').hidden=!loaded;
 for(const id of ['reanalyze','save-photo','zoom-in','zoom-out','zoom-reset','upload','camera-open','retake','other-photo'])$(id).disabled=busy;
 $('camera-placeholder').hidden=!!captureStream;
 $('capture-status').textContent=captureStarting?'카메라를 연결하고 있어요…':captureStream?captureNotice:'카메라 권한을 허용해 주세요.';
 $('camera-placeholder').querySelector('strong').textContent=captureStarting?'카메라를 연결하고 있어요':captureNotice;
 $('camera-placeholder').querySelector('p').textContent=captureStarting?'잠시만 기다려 주세요':'카메라 권한을 허용해 주세요.';
 $('shutter').disabled=!captureStream||$('capture-video').readyState<2;
 $('confirm').disabled=busy||!loaded||(!analyzed&&!manualEdited)||confirmed;
 $('confirm').textContent=confirmed?'확인했어요':'확인 완료';$('undo').disabled=busy||!undoStack.length;
 for(const b of document.querySelectorAll('[data-mode]')){b.disabled=busy;b.classList.toggle('selected',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));}
 $('stage').classList.toggle('editing',mode!=='view');
 $('canvas-hint').textContent=mode==='add'?'빠진 알약의 중심을 터치하세요':mode==='remove'?'지울 번호를 터치하세요':'번호를 하나씩 확인해 주세요';
 $('live-capture').hidden=!stream;$('live-capture').disabled=starting||video.readyState<2;
 $('live-stop').hidden=!stream&&!starting;$('live-empty').hidden=!!stream;$('live-badge').hidden=!stream;
 if(starting){$('live-empty').querySelector('h1').textContent='카메라를 연결하고 있어요';$('live-empty').querySelector('p').textContent='잠시만 기다려 주세요.';}
 else{$('live-empty').querySelector('h1').textContent='카메라를 비추면 바로 셉니다';$('live-empty').querySelector('p').innerHTML='알약을 모두 화면에 담고<br>휴대폰을 잠시 고정해 주세요.';}
}
function fit(){
 if(!loaded||currentTab!=='photo')return;
 const stage=$('stage');scale=Math.max(.01,Math.min(stage.clientWidth/source.width,stage.clientHeight/source.height)*zoom);
 const width=source.width*scale,height=source.height*scale;
 const limitX=Math.max(0,(width-stage.clientWidth)/2),limitY=Math.max(0,(height-stage.clientHeight)/2);
 panX=Math.max(-limitX,Math.min(limitX,panX));panY=Math.max(-limitY,Math.min(limitY,panY));
 const frame=canvas.parentElement;
 frame.style.left=`${(stage.clientWidth-width)/2+panX}px`;frame.style.top=`${(stage.clientHeight-height)/2+panY}px`;
 canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;
 if(canvas.width!==source.width||canvas.height!==source.height){canvas.width=source.width;canvas.height=source.height;rasterDirty=true;}
 draw();
}
function zoomAt(value,clientX,clientY){
 if(!loaded||busy)return;
 const stage=$('stage'),rect=stage.getBoundingClientRect(),next=Math.max(1,Math.min(6,value)),ratio=next/zoom;
 const x=(clientX??(rect.left+rect.width/2))-rect.left-stage.clientWidth/2;
 const y=(clientY??(rect.top+rect.height/2))-rect.top-stage.clientHeight/2;
 panX=x-(x-panX)*ratio;panY=y-(y-panY)*ratio;zoom=next;fit();
}
photoGestures($('stage'),{zoomAt,getZoom:()=>zoom,canMove:()=>loaded&&!busy&&mode==='view',tap:e=>{if(e.target===canvas)editPhoto(e);},panBy:(x,y)=>{
 if(!loaded||busy)return;panX+=x;panY+=y;fit();
}});
function markers(context,items,radius){
 items.forEach((o,i)=>{
  context.beginPath();context.arc(o.x,o.y,radius,0,Math.PI*2);context.fillStyle=o.source==='manual'?'#306ec8':'#087961';context.fill();
  context.strokeStyle='#fff';context.lineWidth=radius*.13;context.stroke();context.fillStyle='#fff';context.font=`700 ${radius*(i>=99?.88:1.05)}px system-ui`;
  context.textAlign='center';context.textBaseline='middle';context.fillText(String(i+1),o.x,o.y+radius*.03);
 });
}
function viewportZoom(){return Math.max(1,window.visualViewport?.scale||1);}
function draw(){
 if(!loaded)return;
 if(rasterDirty){ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0);rasterDirty=false;}
 // Separate labels from the photo raster: image zoom cannot enlarge or blur them.
 const overlay=$('markers');overlay.style.setProperty('--inverse-pinch',String(1/viewportZoom()));
 if(renderedObjects!==objects||renderedLength!==objects.length){
  overlay.replaceChildren(...objects.map((o,i)=>{
   const marker=document.createElement('span');marker.className=`marker${o.source==='manual'?' manual':''}${i>=99?' wide':''}`;
   marker.textContent=String(i+1);marker.style.left=`${o.x/source.width*100}%`;marker.style.top=`${o.y/source.height*100}%`;return marker;
  }));
  renderedObjects=objects;renderedLength=objects.length;
 }
}
function readingOrder(items){
 const radii=items.map(o=>o.r).sort((a,b)=>a-b),tolerance=Math.max(4,(radii[Math.floor(radii.length/2)]||10)*.8),rows=[];
 for(const o of [...items].sort((a,b)=>a.y-b.y)){let row=rows.at(-1);if(!row||o.y-row.y>tolerance){row={y:o.y,items:[]};rows.push(row);}row.items.push(o);}
 return rows.flatMap(row=>row.items.sort((a,b)=>a.x-b.x));
}
function captureTo(target,image,maxSide=2048){
 const width=image.videoWidth||image.naturalWidth||image.width,height=image.videoHeight||image.naturalHeight||image.height;
 if(!width||!height)throw Error('카메라 화면이 준비되지 않았습니다. 잠시 후 다시 눌러 주세요.');
 const ratio=Math.min(1,maxSide/Math.max(width,height));target.width=Math.max(1,Math.round(width*ratio));target.height=Math.max(1,Math.round(height*ratio));
 target.getContext('2d').drawImage(image,0,0,target.width,target.height);
}
function stopAnalysis(){sequence++;detector.cancel();busy=false;}
async function analyze(focusCount=false){
 if(!loaded)return;
 stopAnalysis();const request=sequence;busy=true;analyzed=false;manualEdited=false;objects=[];undoStack=[];analysis=null;invalidate();message('');update();draw();
 try{
  const result=await detector.analyze(source.getContext('2d').getImageData(0,0,source.width,source.height),{confidence:.5},text=>{if(request===sequence)$('busy-text').textContent=text;});
  if(request!==sequence)return;analysis=result;objects=readingOrder(result.objects);analyzed=true;
  if(!objects.length)message('알약을 찾지 못했어요. 밝기와 거리를 바꾸거나 직접 추가해 주세요.');
 }catch(error){if(request===sequence)message(`${error.message} 다시 세거나 직접 추가할 수 있어요.`,true);}
 finally{if(request===sequence){busy=false;update();fit();if(focusCount)requestAnimationFrame(()=>document.querySelector('.counter').scrollIntoView({behavior:'smooth',block:'start'}));}}
}
function loadImage(image,file=null,{focusCount=false}={}){
 captureMode=false;stopCaptureCamera();stopLive();stopAnalysis();currentTab='photo';captureTo(source,image);rasterDirty=true;originalFile=file;
 $('dropzone').classList.toggle('camera-result',file===null);
 loaded=true;analyzed=false;manualEdited=false;objects=[];undoStack=[];mode='view';zoom=1;panX=panY=0;analysis=null;invalidate();update();fit();void analyze(focusCount);
}
async function fileSelected(file,{focusCount=false}={}){
 if(!file)return;const request=++imageRequest;
 if(file.type&&!file.type.startsWith('image/')){message('사진 파일을 선택해 주세요.',true);return;}
 if(file.size>35*1024*1024){message('35MB 이하의 사진을 선택해 주세요.',true);return;}
 const url=URL.createObjectURL(file),image=new Image();
 try{image.src=url;await image.decode();if(request!==imageRequest)return;if(image.naturalWidth*image.naturalHeight>80000000)throw Error('oversized');loadImage(image,file,{focusCount});}
 catch{if(request===imageRequest)message('사진을 읽을 수 없어요. 해상도를 줄이거나 JPG·PNG 사진을 선택해 주세요.',true);}
 finally{URL.revokeObjectURL(url);}
}
function stopLive(){
 liveSession++;clearTimeout(liveTimer);clearInterval(liveAgeTimer);liveTimer=null;liveAgeTimer=null;starting=false;
 if(stream)stream.getTracks().forEach(track=>track.stop());stream=null;video.srcObject=null;detector.cancel();
}
function stopCaptureCamera(){
 captureGeneration++;captureStarting=false;
 if(captureStream)captureStream.getTracks().forEach(track=>track.stop());
 captureStream=null;$('capture-video').srcObject=null;
}
function closeCaptureMode(){imageRequest++;captureMode=false;stopCaptureCamera();update();fit();}
async function startCaptureCamera(){
 if(!captureMode||captureStarting||captureStream)return;
 if(!navigator.mediaDevices?.getUserMedia){captureNotice='카메라를 사용할 수 없어요. 사진 선택을 이용해 주세요.';update();return;}
 captureStarting=true;captureNotice='카메라를 여는 중이에요…';const generation=++captureGeneration;update();let candidate=null;
 try{
  candidate=await navigator.mediaDevices.getUserMedia(cameraConstraints());
  if(generation!==captureGeneration||!captureMode||document.hidden){candidate.getTracks().forEach(track=>track.stop());return;}
  captureStream=candidate;$('capture-video').srcObject=captureStream;await $('capture-video').play();
  if(generation!==captureGeneration)return;
  if($('capture-video').readyState<2)await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{ $('capture-video').removeEventListener('loadeddata',ready);reject(new Error('camera_timeout'));},10000);
   function ready(){clearTimeout(timer);resolve();}$('capture-video').addEventListener('loadeddata',ready,{once:true});
  });
  if(generation!==captureGeneration)return;
  captureStarting=false;captureNotice='알약이 모두 보이도록 화면을 맞춰 주세요.';update();
  captureStream.getVideoTracks().forEach(track=>track.addEventListener('ended',()=>{
   if(generation===captureGeneration){stopCaptureCamera();captureNotice='카메라가 연결되지 않았어요. 다시 열거나 사진을 선택해 주세요.';update();}
  }));
 }catch(error){
  candidate?.getTracks().forEach(track=>track.stop());if(generation!==captureGeneration)return;
  captureStream=null;$('capture-video').srcObject=null;captureStarting=false;
  captureNotice=error.name==='NotAllowedError'?'카메라 권한을 허용하거나 사진을 선택해 주세요.':error.name==='NotFoundError'?'카메라를 찾지 못했어요. 사진을 선택해 주세요.':'카메라를 열지 못했어요. 다시 시도하거나 사진을 선택해 주세요.';
  message(captureNotice,true);update();
 }
}
function openCaptureMode(){
 if(captureMode){void startCaptureCamera();return;}
 if(currentTab==='live')stopLive();
 captureMode=true;currentTab='photo';captureNotice='카메라 권한을 허용해 주세요.';message('');update();void startCaptureCamera();
}
function takePhoto(){
 if(!captureStream||$('capture-video').readyState<2)return;
 const photo=document.createElement('canvas');
 try{captureToFrame(photo,$('capture-video'));loadImage(photo,null,{focusCount:true});}
 catch(error){captureNotice=error.message;update();}
}
function switchTab(tab){
 dispensing.stopScanner();
 if(captureMode)stopCaptureCamera();captureMode=false;
 if(currentTab===tab){update();if(tab==='dispense')dispensing.show();if(tab==='live'&&!stream&&!starting)void startLive();return;}imageRequest++;stopLive();stopAnalysis();currentTab=tab;message('');
 if(tab==='live'){liveCount=null;liveAt=0;$('live-hint').textContent='카메라를 열고 첫 화면을 분석하고 있어요…';}
 update();fit();if(tab==='dispense')dispensing.show();if(tab==='live')void startLive();
}
function resetPhoto(){
 imageRequest++;captureMode=false;stopCaptureCamera();stopLive();stopAnalysis();releaseSave();currentTab='photo';
 loaded=false;analyzed=false;manualEdited=false;originalFile=null;analysis=null;objects=[];undoStack=[];mode='view';zoom=1;panX=panY=0;
 liveCount=null;liveAt=0;source.width=source.height=1;canvas.width=canvas.height=1;$('markers').replaceChildren();renderedObjects=null;invalidate();message('');update();
}
function backWithinApp(){
 if(dispensing.closeDialog())return;
 if($('save-dialog').open){$('save-dialog').close();return;}
 if($('leave-dialog').open){$('leave-dialog').close();return;}
 if($('exit-dialog').open){$('exit-dialog').close();return;}
 if(captureMode){closeCaptureMode();return;}
 if(currentTab==='dispense'){switchTab('photo');return;}
 if(currentTab==='live'){switchTab('photo');return;}
 if(busy){stopAnalysis();update();message('분석을 멈췄어요. 사진은 그대로 남아 있습니다.');return;}
 if(mode!=='view'){mode='view';update();return;}
 if(zoom>1){zoom=1;panX=panY=0;fit();return;}
 if(loaded){$('leave-dialog').showModal();return;}
 $('exit-dialog').showModal();
}
const navigation=pcView?{exit(){location.assign('exit.html');}}:appNavigation(backWithinApp);
async function startLive(){
 if(starting||stream)return;
 if(!navigator.mediaDevices?.getUserMedia){message('이 브라우저에서 카메라를 열 수 없어요. Safari나 Chrome에서 열거나 사진 촬영을 이용해 주세요.',true);return;}
 stopAnalysis();stopLive();const session=liveSession;starting=true;liveCount=null;liveAt=0;liveErrors=0;message('');update();let candidate=null;
 try{
  candidate=await navigator.mediaDevices.getUserMedia(cameraConstraints());
  if(session!==liveSession||document.hidden){candidate.getTracks().forEach(t=>t.stop());return;}
  stream=candidate;video.srcObject=stream;await video.play();if(session!==liveSession)return;
  if(video.readyState<2)await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{video.removeEventListener('loadeddata',ready);reject(Error('camera_timeout'));},10000);
   function ready(){clearTimeout(timer);resolve();}video.addEventListener('loadeddata',ready,{once:true});
  });
  if(session!==liveSession)return;starting=false;update();
  liveAgeTimer=setInterval(()=>{
   if(!liveAt)return;
   const seconds=Math.floor((Date.now()-liveAt)/1000);
   $('count-meta').textContent=seconds?`${seconds}초 전 분석한 수량`:'방금 분석한 수량';
   if(seconds>=5){$('count').value='—';setStatus('분석 대기');$('live-hint').textContent='최신 화면을 분석하고 있어요…';}
  },1000);
  for(const track of stream.getVideoTracks())track.addEventListener('ended',()=>{if(session===liveSession){stopLive();update();message('카메라 연결이 끊겼어요. 다시 시작해 주세요.',true);}});
  void liveTick(session);
 }catch(error){
  candidate?.getTracks().forEach(t=>t.stop());if(session!==liveSession)return;stopLive();update();
  message(error.name==='NotAllowedError'?'카메라 권한을 허용해 주세요. 사진 촬영·선택도 이용할 수 있어요.':error.name==='NotFoundError'?'카메라를 찾을 수 없어요. 사진 선택을 이용해 주세요.':'카메라를 열지 못했어요. 다른 앱의 카메라를 닫고 다시 시도해 주세요.',true);
 }
}
async function liveTick(session){
 if(session!==liveSession||!stream||document.hidden)return;
 const started=performance.now(),frame=document.createElement('canvas');
 try{
  captureToFrame(frame,video);
  const result=await detector.analyze(frame.getContext('2d').getImageData(0,0,frame.width,frame.height),{confidence:.5,jpeg:true,timeoutMs:20000});
  if(session!==liveSession)return;liveCount=result.objects.length;liveAt=Date.now();liveErrors=0;message('');update();
  $('live-hint').textContent=`방금 분석 · ${(result.processingTimeMs/1000).toFixed(1)}초 소요 · 휴대폰을 고정해 주세요`;
 }catch(error){
  if(session!==liveSession)return;liveErrors++;liveCount=null;update();setStatus('연결 확인 중','error');$('live-hint').textContent='분석 연결을 기다리고 있어요…';
  if(liveErrors>=3){stopLive();update();message('분석 연결이 원활하지 않아 멈췄어요. 인터넷 연결을 확인하고 다시 시작해 주세요.',true);return;}
 }
 if(session===liveSession&&stream){const delay=liveErrors?2000:Math.max(150,1000-(performance.now()-started));liveTimer=setTimeout(()=>void liveTick(session),delay);}
}
function freezeLive(){
 if(!stream||video.readyState<2)return;const photo=document.createElement('canvas');
 try{captureToFrame(photo,video);imageRequest++;loadImage(photo,null,{focusCount:true});}catch(error){message(error.message,true);}
}
function canvasBlob(image,type='image/jpeg',quality=.95){return new Promise((resolve,reject)=>image.toBlob(blob=>blob?resolve(blob):reject(Error('사진을 준비하지 못했어요.')),type,quality));}
function releaseSave(){saveGeneration++;if(saveURL)URL.revokeObjectURL(saveURL);saveURL=null;saveFile=null;}
async function prepareSave(kind){
 releaseSave();const request=saveGeneration;$('save-device').disabled=true;$('save-download').hidden=true;$('save-status').textContent='';$('save-help').textContent='사진을 준비하고 있어요…';
 for(const [id,value] of [['save-plain','plain'],['save-marked','marked']]){$(id).classList.toggle('selected',kind===value);$(id).setAttribute('aria-pressed',String(kind===value));}
 try{
  let blob;
  if(kind==='plain'&&originalFile&&/^image\/(jpeg|png|webp)$/.test(originalFile.type)){blob=originalFile;}
  else{
   const output=document.createElement('canvas');
   output.width=source.width;output.height=source.height;const c=output.getContext('2d');c.drawImage(source,0,0);
   if(kind==='marked')markers(c,objects,Math.max(10,source.width/70));
   blob=await canvasBlob(output);
  }
  if(request!==saveGeneration||!$('save-dialog').open)return;
  const ext=blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg';
  saveFile=new File([blob],`알약-${kind==='marked'?objects.length+'개-':''}${new Date().toISOString().replace(/[:.]/g,'-')}.${ext}`,{type:blob.type});
  saveURL=URL.createObjectURL(saveFile);$('save-preview').src=saveURL;$('save-download').href=saveURL;$('save-download').download=saveFile.name;$('save-download').hidden=false;$('save-device').disabled=false;
  $('save-help').textContent='휴대폰에 저장을 누르면 사진 파일을 내려받습니다. 다운로드 폴더에서 확인해 주세요.';
 }catch{if(request===saveGeneration)$('save-help').textContent='사진을 준비하지 못했어요. 창을 닫고 다시 시도해 주세요.';}
}
function saveToDevice(){
 if(!saveFile||saving)return;saving=true;$('save-device').disabled=true;
 $('save-download').click();$('save-status').textContent='사진 파일을 내려받았어요. 휴대폰의 다운로드에서 확인해 주세요.';
 setTimeout(()=>{saving=false;$('save-device').disabled=!saveFile;},900);
}
$('photo-tab').onclick=()=>switchTab('photo');$('live-tab').onclick=()=>switchTab('live');$('dispense-tab').onclick=()=>switchTab('dispense');
$('camera-open').onclick=openCaptureMode;$('capture-close').onclick=closeCaptureMode;$('shutter').onclick=takePhoto;
$('retake').onclick=openCaptureMode;
$('other-photo').onclick=()=>$('file-input').click();
$('photo-back').onclick=backWithinApp;
$('capture-gallery').onclick=()=>$('file-input').click();
$('upload').onclick=()=>$('file-input').click();
$('file-input').onchange=e=>{void fileSelected(e.target.files[0]);e.target.value='';};
$('reanalyze').onclick=()=>{if(undoStack.length&&!window.confirm('수정한 표시를 지우고 다시 셀까요?'))return;void analyze();};
$('cancel').onclick=()=>{stopAnalysis();update();message('분석을 취소했어요. 다시 세거나 직접 추가할 수 있어요.');};
 document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{mode=button.dataset.mode;update();});
function editPhoto(e){
 if(!loaded||busy||mode==='view')return;
 const rect=canvas.getBoundingClientRect(),x=(e.clientX-rect.left)*canvas.width/rect.width,y=(e.clientY-rect.top)*canvas.height/rect.height,previous=clone();
 if(mode==='add')objects.push({x,y,r:12/scale,source:'manual'});
 else{
  let nearest=-1,distance=Infinity;objects.forEach((o,i)=>{const d=Math.hypot(o.x-x,o.y-y);if(d<distance&&d<Math.max(22/scale,o.r*.75)){distance=d;nearest=i;}});
  if(nearest<0){message('지울 번호 가까이를 터치해 주세요.');return;}objects.splice(nearest,1);
 }
 manualEdited=true;undoStack.push(previous);if(undoStack.length>60)undoStack.shift();invalidate();message('');update();draw();
}
canvas.onclick=editPhoto;
$('undo').onclick=()=>{if(!undoStack.length)return;objects=undoStack.pop();invalidate();update();draw();};
$('zoom-in').onclick=()=>zoomAt(zoom+.5);$('zoom-out').onclick=()=>zoomAt(zoom-.5);$('zoom-reset').onclick=()=>{zoom=1;panX=panY=0;fit();};
$('confirm').onclick=()=>{
 confirmed=true;$('confirmation').textContent=`직접 확인한 수량은 ${objects.length}개입니다.`;update();
 if(dispensingCount){
  if(dispensing.acceptCount(objects.length)){dispensingCount=false;switchTab('dispense');$('dispense-count-heading').scrollIntoView({behavior:'smooth',block:'start'});}
  else message('소분 라벨에는 1개 이상의 수량이 필요해요. 사진의 번호를 확인해 주세요.',true);
 }
};
$('live-stop').onclick=()=>{stopLive();update();$('live-hint').textContent='다시 연결하려면 실시간 카운팅 탭을 눌러 주세요.';};$('live-capture').onclick=freezeLive;
$('save-photo').onclick=()=>{if(!loaded||busy)return;$('save-marked').disabled=!analyzed&&!manualEdited;$('save-dialog').showModal();void prepareSave('plain');};
$('save-close').onclick=()=>$('save-dialog').close();$('save-dialog').addEventListener('close',releaseSave);
$('leave-cancel').onclick=()=>$('leave-dialog').close();$('leave-confirm').onclick=()=>{$('leave-dialog').close();resetPhoto();};
$('exit-cancel').onclick=()=>$('exit-dialog').close();
$('exit-confirm').onclick=()=>{
 $('exit-dialog').close();
 navigation.exit();
};
$('save-plain').onclick=()=>void prepareSave('plain');$('save-marked').onclick=()=>void prepareSave('marked');$('save-device').onclick=()=>void saveToDevice();
const dropzone=$('dropzone');for(const name of ['dragenter','dragover'])dropzone.addEventListener(name,e=>{e.preventDefault();if(!busy)dropzone.classList.add('dragging');});
for(const name of ['dragleave','drop'])dropzone.addEventListener(name,e=>{e.preventDefault();dropzone.classList.remove('dragging');});dropzone.addEventListener('drop',e=>{if(!busy)void fileSelected(e.dataTransfer.files[0]);});
new ResizeObserver(fit).observe($('dropzone'));
window.visualViewport?.addEventListener('resize',()=>{if(currentTab==='photo')draw();});
document.addEventListener('visibilitychange',()=>{
 if(document.hidden){
  if(captureMode&&(captureStream||captureStarting)){stopCaptureCamera();captureNotice='카메라를 다시 연결하고 있어요…';}
  if(stream||starting){stopLive();$('live-hint').textContent='화면을 벗어나 카메라를 멈췄어요. 다시 시작을 눌러 주세요.';}
  update();
 }else if(captureMode&&!captureStream&&!captureStarting)void startCaptureCamera();
 else if(currentTab==='live'&&!stream&&!starting)void startLive();
});
window.addEventListener('pagehide',()=>{imageRequest++;captureMode=false;stopCaptureCamera();stopLive();stopAnalysis();$('save-dialog').close();releaseSave();});
window.addEventListener('pageshow',()=>{update();fit();if(captureMode&&!captureStream&&!captureStarting&&!document.hidden)void startCaptureCamera();});
if(new URLSearchParams(location.search).has('test'))window.__pillCounterTest={state:()=>({loaded,analyzed,busy,mode,zoom,panX,panY,captureMode,captureStarting,captureActive:!!captureStream,objects:clone(),count:objects.length,currentTab,liveCount,liveAt,streamActive:!!stream,starting,confirmed,width:source.width,height:source.height,analysis}),fileSelected};
update();
