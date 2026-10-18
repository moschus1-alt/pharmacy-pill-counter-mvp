import {OpenCVDetector} from './detector.js';
import {AIDetector} from './ai-detector.js';
const $=id=>document.getElementById(id);
const cvDetector=new OpenCVDetector(),aiDetector=new AIDetector();
const detector={cancel(){cvDetector.cancel();aiDetector.cancel();}};
const source=document.createElement('canvas'),canvas=$('canvas'),ctx=canvas.getContext('2d');
// Send the same 640x640 resampling to the worker without a full-size RGBA transfer.
const aiInput=document.createElement('canvas');aiInput.width=aiInput.height=640;
const aiInputContext=aiInput.getContext('2d',{willReadFrequently:true});
function readAIInput(){
 aiInputContext.imageSmoothingEnabled=true;aiInputContext.imageSmoothingQuality='low';
 aiInputContext.clearRect(0,0,640,640);aiInputContext.drawImage(source,0,0,640,640);
 return aiInputContext.getImageData(0,0,640,640);
}
let loaded=false,objects=[],automaticCount=0,undoStack=[],redoStack=[],mode='view',zoom=1,scale=1,busy=false,sequence=0,imageRequest=0,sample=false,analysis=null,confirmed=false,filename='',manualId=0;
const clone=()=>structuredClone(objects);
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
function invalidate(){confirmed=false;$('verified').checked=false;$('confirmation').textContent='';$('export').disabled=true;}
function update(){
 $('count').value=loaded?String(objects.length):'—';
 const additions=objects.filter(o=>o.source==='manual').length,removed=automaticCount-objects.filter(o=>o.source!=='manual').length;
 $('count-meta').textContent=loaded?`${sample?'예제 · ':''}자동 ${automaticCount}개${additions?` · 추가 ${additions}개`:''}${removed?` · 삭제 ${removed}개`:''}${analysis?` · ${(analysis.processingTimeMs/1000).toFixed(1)}초`:''}`:'사진을 선택해 시작하세요';
 const target=targetCount(),diff=objects.length-target;
 $('difference').classList.toggle('match',loaded&&target>0&&diff===0);
 $('difference').textContent=$('target').value!==''&&target===null?'목표는 1~9999 사이의 정수로 입력해 주세요.':loaded&&target>0?(diff===0?'목표와 수량이 같습니다. 번호도 직접 확인하세요.':`목표 ${target}개보다 ${Math.abs(diff)}개 ${diff>0?'많습니다':'적습니다'}.`):'목표 수량에 맞춰 검출 수를 바꾸지 않습니다.';
 for(const id of ['replace','zoom-in','zoom-out','zoom-reset','reanalyze','verified','compare'])$(id).disabled=!loaded||busy;
 $('engine').disabled=busy;$('confidence').disabled=busy;
 $('suppress-containers').disabled=busy||$('engine').value!=='ai';$('wasm-threads').disabled=busy||$('engine').value!=='ai';
 $('undo').disabled=!undoStack.length||busy;$('redo').disabled=!redoStack.length||busy;
 $('complete').disabled=!loaded||busy||!$('verified').checked||confirmed;
 for(const button of document.querySelectorAll('[data-mode]')){button.disabled=busy||(button.dataset.mode!=='view'&&!loaded);button.classList.toggle('active',button.dataset.mode===mode);button.setAttribute('aria-pressed',String(button.dataset.mode===mode));}
 $('stage').classList.toggle('editing',mode!=='view');
 $('canvas-hint').textContent=!loaded?'사진을 선택하면 번호가 여기에 표시됩니다.':mode==='add'?'빠진 알약의 중심을 터치하면 번호가 추가됩니다.':mode==='remove'?'삭제할 번호 가까이를 터치하세요.':'번호를 하나씩 확인하세요. 확대 후 화면을 스크롤할 수 있습니다.';
}
function targetCount(){const n=Number($('target').value);return Number.isInteger(n)&&n>=1&&n<=9999?n:null;}
function readingOrder(items){
 const radii=items.map(o=>o.r).sort((a,b)=>a-b),tolerance=Math.max(4,(radii[Math.floor(radii.length/2)]||10)*.8);
 const rows=[];
 for(const o of [...items].sort((a,b)=>a.y-b.y)){let row=rows.at(-1);if(!row||o.y-row.y>tolerance){row={y:o.y,items:[]};rows.push(row);}row.items.push(o);}
 return rows.flatMap(row=>row.items.sort((a,b)=>a.x-b.x));
}
function saveUndo(){undoStack.push(clone());if(undoStack.length>60)undoStack.shift();redoStack=[];invalidate();}
function fit(){
 if(!loaded)return;
 const stage=$('stage');const base=Math.min(stage.clientWidth/source.width,stage.clientHeight/source.height);
 scale=base*zoom;
 canvas.width=source.width;canvas.height=source.height;
 canvas.style.width=`${source.width*scale}px`;canvas.style.height=`${source.height*scale}px`;
 $('zoom-value').value=`${Math.round(zoom*100)}%`;draw();
}
function draw(){
 if(!loaded)return;
 ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0);
 const markerRadius=11/scale;
 objects.forEach((o,i)=>{
  const color=o.source==='manual'?'#397dce':o.needsReview?'#d58c20':'#138c76';
  if(o.contour?.length){ctx.beginPath();o.contour.forEach(([x,y],j)=>j?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.strokeStyle=color;ctx.fillStyle=color+'24';ctx.lineWidth=1.5/scale;ctx.fill();ctx.stroke();}
  ctx.beginPath();ctx.arc(o.x,o.y,markerRadius,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#ffffff';ctx.lineWidth=1.3/scale;ctx.stroke();
  ctx.fillStyle='white';ctx.font=`600 ${11/scale}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),o.x,o.y+.4/scale);
 });
}
function setBusy(value){busy=value;$('busy').hidden=!value;if(value)$('busy-text').textContent='사진을 분석하고 있습니다…';for(const id of ['camera','upload','demo','real-demo'])$(id).disabled=value;update();}
async function analyze(){
 if(!loaded)return;
 const request=++sequence;setBusy(true);message('');
 try{
  const engine=$('engine').value,isAI=engine==='ai';
  const imageData=isAI?readAIInput():source.getContext('2d').getImageData(0,0,source.width,source.height);
  const result=await (isAI?aiDetector:cvDetector).analyze(imageData,{sensitivity:Number($('sensitivity').value)/100,suppressReflections:$('reflections').checked,confidence:Number($('confidence').value)/100,suppressContainers:$('suppress-containers').checked,originalWidth:source.width,originalHeight:source.height,wasmThreads:Number($('wasm-threads').value)},text=>{$('busy-text').textContent=text;});
  if(request!==sequence)return;
  analysis=result;objects=readingOrder(result.objects);automaticCount=objects.length;undoStack=[];redoStack=[];invalidate();
  $('thread-result').textContent=isAI?`실행 ${result.detector.parameters.wasmThreads}스레드 · 추론 ${(result.inferenceTimeMs/1000).toFixed(1)}초 · 모델 로드/검증 ${(result.modelLoadTimeMs/1000).toFixed(1)}초 · 세션 초기화 ${(result.sessionInitTimeMs/1000).toFixed(1)}초${result.fallbackFromThreads?' · 2스레드 실패 후 자동 복구':''}`:'OpenCV 인식';
  message((sample?'예제는 실제 수량 30개인 합성 이미지이며 AI의 실사진 성능을 입증하지 않습니다.\n':'')+(result.fallbackFromThreads?'2스레드 오류로 1스레드에서 분석했습니다.\n':'')+result.warnings.join('\n'));
  $('result-engine').textContent=isAI?'AI · DEIMv2-X':'OpenCV';
 }catch(error){if(request===sequence)message(`${error.message} 누락 추가 모드로 직접 표시할 수 있습니다.`,true);}
 finally{if(request===sequence){setBusy(false);fit();}}
}
function loadImage(image,name,isSample=false){
 detector.cancel();sequence++;loaded=true;sample=isSample;filename=name;zoom=1;mode='view';analysis=null;objects=[];automaticCount=0;undoStack=[];redoStack=[];invalidate();$('comparison').textContent='';
 const maxSide=1280;
 const ratio=Math.min(1,maxSide/Math.max(image.width,image.height));source.width=Math.round(image.width*ratio);source.height=Math.round(image.height*ratio);
 source.getContext('2d').drawImage(image,0,0,source.width,source.height);
 $('empty').hidden=true;$('stage').hidden=false;fit();analyze();
}
async function fileSelected(file){
 if(!file)return;const request=++imageRequest;if(!/^image\//.test(file.type)){message('JPG, PNG, WebP 등 이미지 파일을 선택해 주세요.',true);return;}
 if(file.size>35*1024*1024){message('사진은 35MB 이하로 선택해 주세요.',true);return;}
 const url=URL.createObjectURL(file),image=new Image();
 image.onload=()=>{URL.revokeObjectURL(url);if(request!==imageRequest)return;if(image.width*image.height>80000000){message('사진 해상도가 너무 큽니다. 축소한 사진을 선택해 주세요.',true);return;}loadImage(image,file.name);};
 image.onerror=()=>{URL.revokeObjectURL(url);if(request===imageRequest)message('이 사진을 읽을 수 없습니다. JPG 또는 PNG로 변환해 주세요.',true);};image.src=url;
}
function demo(){
 imageRequest++;
 const demoCanvas=document.createElement('canvas');demoCanvas.width=1000;demoCanvas.height=700;const c=demoCanvas.getContext('2d');
 c.fillStyle='#304c51';c.fillRect(0,0,1000,700);
 for(let row=0;row<5;row++)for(let col=0;col<6;col++){
  const x=112+col*155+(row%2)*7,y=100+row*125;
  c.save();c.translate(x,y);c.rotate(((row+col)%3-1)*.24);c.fillStyle=(row+col)%3===0?'#efd9a0':'#f3f2e8';c.beginPath();c.ellipse(0,0,33,23,0,0,Math.PI*2);c.fill();c.restore();
 }loadImage(demoCanvas,'합성 알약 30개',true);
}
$('upload').onclick=$('replace').onclick=()=>$('file-input').click();$('camera').onclick=()=>$('camera-input').click();
for(const id of ['file-input','camera-input'])$(id).onchange=e=>{fileSelected(e.target.files[0]);e.target.value='';};
$('demo').onclick=demo;$('reanalyze').onclick=()=>{if(undoStack.length&&!window.confirm('현재 수동 수정을 초기화하고 다시 분석할까요?'))return;analyze();};
$('real-demo').onclick=async()=>{const request=++imageRequest;try{const response=await fetch('examples/mediseg-8-pills.png');if(!response.ok)throw Error('공개 예제 사진을 읽지 못했습니다.');const blob=await response.blob();if(request!==imageRequest)return;fileSelected(new File([blob],'MEDISEG-Deploy 공개 실사진 · 정답 8개.png',{type:'image/png'}));}catch(error){if(request===imageRequest)message(error.message,true);}};
$('confidence').oninput=()=>$('confidence-value').value=(Number($('confidence').value)/100).toFixed(2);
const engineConfidence={ai:50,opencv:50};let previousEngine='ai';
$('engine').onchange=()=>{
 engineConfidence[previousEngine]=Number($('confidence').value);previousEngine=$('engine').value;
 $('confidence').value=String(engineConfidence[previousEngine]);$('confidence').dispatchEvent(new Event('input'));
 message('분석 엔진을 바꿨습니다. 다시 분석을 누르면 적용됩니다.');$('compare').textContent='같은 사진으로 AI / OpenCV 비교';update();
};
$('compare').onclick=async()=>{
 const request=++sequence;setBusy(true);$('comparison').textContent='두 엔진으로 같은 사진을 비교 중입니다…';
 try{
  const read=()=>source.getContext('2d').getImageData(0,0,source.width,source.height);
  const ai=await aiDetector.analyze(readAIInput(),{confidence:Number($('confidence').value)/100,suppressContainers:$('suppress-containers').checked,originalWidth:source.width,originalHeight:source.height,wasmThreads:Number($('wasm-threads').value)},t=>$('busy-text').textContent=t);
  const cv=await cvDetector.analyze(read(),{sensitivity:Number($('sensitivity').value)/100,suppressReflections:$('reflections').checked});
  if(request!==sequence)return;
  $('comparison').textContent=`AI ${ai.objects.length}개 (${(ai.processingTimeMs/1000).toFixed(1)}초) · OpenCV ${cv.objects.length}개 (${(cv.processingTimeMs/1000).toFixed(1)}초)\n수량 차이만으로 정확도를 판단하지 마세요. 실제 알약과 번호를 대조해야 합니다.`;
 }catch(e){if(request===sequence)$('comparison').textContent=e.message;}
 finally{if(request===sequence)setBusy(false);}
};
$('cancel').onclick=()=>{sequence++;detector.cancel();setBusy(false);message('자동 분석을 취소했습니다. 직접 표시하거나 다시 분석할 수 있습니다.');fit();};
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;update();});
canvas.onclick=e=>{
 if(!loaded||busy||mode==='view')return;
 const rect=canvas.getBoundingClientRect(),x=(e.clientX-rect.left)*canvas.width/rect.width,y=(e.clientY-rect.top)*canvas.height/rect.height;
 if(mode==='add'){saveUndo();objects.push({id:`manual-${++manualId}`,x,y,r:12/scale,source:'manual'});}
 else{
  let nearest=-1,distance=Infinity;
  objects.forEach((o,i)=>{const d=Math.hypot(o.x-x,o.y-y);if(d<distance&&d<Math.max(22/scale,o.r*.75)){distance=d;nearest=i;}});
  if(nearest<0){message('지울 번호 가까이를 터치해 주세요.');return;}
  saveUndo();objects.splice(nearest,1);
 }message('수정한 번호를 확인한 후 최종 확인란을 체크해 주세요.');update();draw();
};
$('undo').onclick=()=>{if(!undoStack.length)return;redoStack.push(clone());objects=undoStack.pop();invalidate();update();draw();};
$('redo').onclick=()=>{if(!redoStack.length)return;undoStack.push(clone());objects=redoStack.pop();invalidate();update();draw();};
$('zoom-in').onclick=()=>{zoom=Math.min(4,zoom+.25);fit();};$('zoom-out').onclick=()=>{zoom=Math.max(1,zoom-.25);fit();};$('zoom-reset').onclick=()=>{zoom=1;fit();};
$('target').oninput=()=>{invalidate();update();};$('sensitivity').oninput=()=>$('sensitivity-value').value=(Number($('sensitivity').value)/100).toFixed(2);
$('verified').onchange=()=>{confirmed=false;$('confirmation').textContent='';$('export').disabled=true;update();};
$('complete').onclick=()=>{confirmed=true;$('confirmation').textContent=`직접 검수한 최종 수량: ${objects.length}개${sample?' (예제)':''}`;$('export').disabled=false;update();};
$('export').onclick=()=>{
 if(!confirmed)return;
 const result={version:1,verifiedAt:new Date().toISOString(),filename,isSynthetic:sample,width:source.width,height:source.height,automaticCount,finalCount:objects.length,targetCount:targetCount(),verifiedByUser:true,detector:analysis?.detector??null,objects:objects.map(({id,x,y,source,r})=>({id,x,y,r,source})),imageIncluded:false};
 const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`pill-count-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
const dropzone=$('dropzone');for(const name of ['dragenter','dragover'])dropzone.addEventListener(name,e=>{e.preventDefault();if(!busy)dropzone.classList.add('dragging');});
for(const name of ['dragleave','drop'])dropzone.addEventListener(name,e=>{e.preventDefault();dropzone.classList.remove('dragging');});dropzone.addEventListener('drop',e=>{if(!busy)fileSelected(e.dataTransfer.files[0]);});
new ResizeObserver(()=>{if(loaded)fit();}).observe($('dropzone'));window.addEventListener('beforeunload',()=>{detector.cancel();aiDetector.dispose();});
if(new URLSearchParams(location.search).has('test'))window.__pillCounterTest={state:()=>({count:objects.length,objects:clone(),busy,mode,sample,confirmed,automaticCount,width:source.width,height:source.height}),demo};
update();
// Pillens integration is paused; the default remains DEIMv2-X.
$('suppress-containers').onchange=()=>message('용기·배경 제외 설정을 바꿨습니다. 다시 분석을 누르면 적용됩니다.');
$('wasm-threads').onchange=()=>message('스레드 설정을 바꿨습니다. 다시 분석하면 새 설정이 적용됩니다.');
$('thread-support').textContent=window.crossOriginIsolated&&typeof SharedArrayBuffer!=='undefined'?'멀티스레드 사용 가능':'이 브라우저에서는 1스레드로 자동 실행됩니다.';
