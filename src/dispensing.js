import {dispensingView,dispensingDialogs} from './dispensing-view.js';
import {parseProductBarcode,barcodePayload,labelDimensions,labelSizeText,localDate,labelIssues,validCount} from './dispensing-data.js';
import {createLabel,labelFits,printLabel} from './label-view.js';
import {barcodeScanner} from './barcode-scanner.js';
import {printConnection} from './print-connection.js';
import {normalizeProductCode} from './product-code.js';

export function setupDispensing({startCounting,cancelCounting,openDispensing}) {
  const $=id=>document.getElementById(id),catalogKey='pill-products-v1';
  document.querySelector('.tabs').insertAdjacentHTML('beforeend','<button id="dispense-tab" aria-pressed="false">의약품예제소분</button>');
  document.querySelector('footer').insertAdjacentHTML('beforebegin',dispensingView);
  document.body.insertAdjacentHTML('beforeend',dispensingDialogs);
  document.querySelector('.counter').before($('dispense-count-banner'));
  let product=null,count=null,connection=null,sending=false,sendJob=null,statusTimer=null;
  const fields={name:'product-name',strength:'product-strength',manufacturer:'product-manufacturer',lot:'product-lot',expiry:'product-expiry',packedOn:'packed-on',useBy:'use-by',size:'label-size',copies:'label-copies'};
  let lookupController=null,lookupVersion=0,lookupPending=false;
  let catalog={};try{catalog=JSON.parse(localStorage.getItem(catalogKey)||'{}');if(!catalog||typeof catalog!=='object'||Array.isArray(catalog))catalog={};}catch{ /* Continue without a saved catalog. */ }
  const paperKey='pill-label-paper-v1';
  function paperSettings(){return {size:$('label-size').value,widthMm:Number($('label-width').value),heightMm:Number($('label-height').value)};}
  try{const saved=JSON.parse(localStorage.getItem(paperKey)||'null');if(saved&&labelDimensions(saved)){$('label-size').value=saved.size;if(['custom','dk22210'].includes(saved.size)){$('label-width').value=saved.widthMm;$('label-height').value=saved.heightMm;}}}catch{}
  function savePaper(){const paper=paperSettings();if(labelDimensions(paper))try{localStorage.setItem(paperKey,JSON.stringify(paper));}catch{}}
  $('packed-on').value=localDate();
  function labelData() {
    const data={code:product?.code||'',count};
    for(const [key,id] of Object.entries(fields))data[key]=$(id).value.trim();
    if(['custom','dk22210'].includes(data.size)){data.widthMm=Number($('label-width').value);data.heightMm=Number($('label-height').value);}
    data.copies=Number(data.copies);return data;
  }
  function clearSent(){clearTimeout(statusTimer);sendJob=null;$('label-send-status').textContent='';}
  function changed({clearQuantity=false}={}) {
    $('label-reviewed').checked=false;clearSent();
    if(clearQuantity){count=null;cancelCounting();}
    render();
  }
  function stopLookup() {
    lookupVersion++;lookupController?.abort();lookupController=null;lookupPending=false;
  }
  function savedProduct(code) {
    const normalized=normalizeProductCode(code);
    for(const key of [code,normalized,normalized?.length===13?'0'+normalized:null])
      if(key&&Object.hasOwn(catalog,key))return catalog[key];
    return null;
  }
  async function lookupBarcode(parsed,saved) {
    const code=normalizeProductCode(parsed.code);
    if(!code){
      $('barcode-status').textContent=saved?'이 기기에 저장한 제품이에요. 공식 조회에 사용할 수 없는 코드이므로 포장과 대조해 주세요.':'공식 조회에는 검증번호가 맞는 13·14자리 제품코드가 필요해요. 바코드를 다시 읽거나 제품명을 직접 입력해 주세요.';
      return;
    }
    const version=++lookupVersion,controller=new AbortController();lookupController=controller;lookupPending=true;
    $('barcode-status').textContent='심평원 공개 데이터에서 제품을 찾고 있어요…';render();
    const timeout=setTimeout(()=>controller.abort(),10000);
    try {
      const response=await fetch('/api/product-lookup?'+new URLSearchParams({code}),{signal:controller.signal});
      if(!response.ok)throw Error('Lookup unavailable');
      const result=await response.json();
      if(version!==lookupVersion)return;
      const source=result.source?`심평원 · ${result.source.asOf} 기준`:'심평원 공개 데이터';
      if(result.status==='found'&&result.product?.code===code&&typeof result.product.name==='string') {
        for(const key of ['name','strength','manufacturer'])$(fields[key]).value=result.product[key]||'';
        $('barcode-status').textContent=`제품 정보를 찾았어요. ${source}. 현재 포장과 제품명·규격을 대조해 주세요.`;
        const item=result.product;
        $('product-lookup-details').textContent=[item.packageQuantity&&item.packageQuantity!=='0'?`등록 포장 수량: ${item.packageQuantity}`:'',item.packageType?`포장: ${item.packageType}`:'','소분 수량은 촬영 후 확인한 값으로 입력돼요.'].filter(Boolean).join(' · ');
        changed();
      } else if(result.status==='historical'||result.status==='ambiguous') {
        for(const key of ['name','strength','manufacturer'])$(fields[key]).value='';
        $('barcode-status').textContent=result.status==='historical'?`취소·양도 이력이 있는 코드예요. ${source}. 현재 포장을 확인하고 제품 정보를 직접 입력해 주세요.`:`같은 코드에 여러 제품 정보가 있어 자동 입력하지 않았어요. ${source}. 포장을 확인하고 직접 입력해 주세요.`;
        changed();
      } else if(result.status==='not_found') {
        $('barcode-status').textContent=`${source} 목록에서 코드를 찾지 못했어요. `+(saved?'이 기기에 저장한 정보를 불러왔으니 현재 포장과 대조해 주세요.':'포장의 제품 정보를 직접 입력해 주세요.');
      } else throw Error('Unexpected lookup response');
    }catch {
      if(version!==lookupVersion)return;
      $('barcode-status').textContent='제품 조회에 연결하지 못했어요. '+(saved?'이 기기에 저장한 정보를 포장과 대조해 주세요.':'포장의 제품 정보를 직접 입력하거나 적용을 눌러 다시 조회해 주세요.');
    }finally {
      clearTimeout(timeout);
      if(version===lookupVersion){lookupPending=false;lookupController=null;render();}
    }
  }
  function applyBarcode({force=false}={}) {
    const parsed=parseProductBarcode($('product-barcode').value);
    if(product?.raw===parsed.raw&&!force)return;
    stopLookup();product=parsed;
    const saved=savedProduct(parsed.code);
    for(const key of ['name','strength','manufacturer'])$(fields[key]).value=typeof saved?.[key]==='string'?saved[key]:'';
    $('product-lot').value=parsed.lot;$('product-expiry').value=parsed.expiry;
    $('use-by').value='';$('packed-on').value=localDate();$('product-lookup-details').textContent='';
    changed({clearQuantity:true});
    void lookupBarcode(parsed,saved);
  }
  function remember() {
    if(!$('remember-product').checked||!product)return;
    const data=labelData();
    Object.defineProperty(catalog,normalizeProductCode(product.code)||product.code,{value:{name:data.name,strength:data.strength,manufacturer:data.manufacturer},enumerable:true,configurable:true,writable:true});
    // Keep the catalog bounded on shared tablets/phones.
    const entries=Object.entries(catalog).slice(-500);catalog=Object.fromEntries(entries);
    try{localStorage.setItem(catalogKey,JSON.stringify(catalog));}catch{$('barcode-status').textContent='기기 저장 공간을 사용할 수 없어요. 이번 라벨은 계속 만들 수 있어요.';}
  }
  function render() {
    for(const id of [...Object.values(fields),'label-width','label-height','product-barcode','remember-product','label-reviewed','barcode-open','barcode-apply','dispense-start-count','dispense-new'])$(id).disabled=sending;
    $('custom-label-fields').hidden=!['custom','dk22210'].includes($('label-size').value);
    const selected=paperSettings();
    $('label-width').disabled=sending||selected.size!=='custom';$('label-height').disabled=sending||!['custom','dk22210'].includes(selected.size);
    const description=labelSizeText(selected);
    $('label-paper-summary').textContent=`선택한 용지: ${description}${labelDimensions(selected)?' · 이 기기에 저장돼요.':''}`;
    $('printer-test-paper').textContent=`테스트 인쇄 용지: ${description}. 크기는 소분 화면의 ‘라벨 크기’에서 변경해 주세요.`;
    const data=labelData(),paper=createLabel(data);
    $('label-preview').replaceChildren(paper);
    const issues=labelIssues(data);
    if(lookupPending)issues.unshift('제품 정보를 조회하고 있어요.');
    $('dispense-start-count').disabled=sending||lookupPending;
    if(product?.raw!==barcodePayload($('product-barcode').value))issues.unshift('입력한 바코드를 적용해 주세요.');
    // Hidden tabs have no layout; check again when the tab becomes visible.
    if(!$('dispense-panel').hidden&&!labelFits(paper))issues.push('내용이 라벨 크기를 넘어가요. 연속 용지의 길이를 늘리거나 더 큰 라벨을 선택해 주세요.');
    $('dispense-count').value=count===null?'—':String(count);
    $('dispense-count-state').textContent=count===null?'카운팅 전':'수량 확인 완료';
    $('dispense-count-state').classList.toggle('active',count!==null);
    $('dispense-start-count').textContent=count===null?'수량 카운팅 시작':'새로 카운팅하기';
    $('label-validation').textContent=issues[0]||'라벨 내용과 실제 수량을 마지막으로 확인해 주세요.';
    $('label-validation').classList.toggle('validation-error',!!issues.length);
    const ready=!issues.length&&$('label-reviewed').checked;
    $('label-send').disabled=!ready||!connection?.connected()||sending||!!sendJob?.submitted;
    $('label-print-local').disabled=!ready||sending;
    $('label-send').textContent=sending?'PC로 전송 중…':sendJob?.submitted?'PC로 전송했어요':'PC로 라벨 전송';
  }
  const scanner=barcodeScanner($('barcode-dialog'),value=>{
    $('product-barcode').value=value;
    try{applyBarcode();}catch(error){$('barcode-status').textContent=error.message;}
  });
  $('barcode-open').onclick=()=>void scanner.start();
  $('barcode-apply').onclick=()=>{try{applyBarcode({force:true});}catch(error){$('barcode-status').textContent=error.message;}};
  $('product-barcode').addEventListener('input',()=>{stopLookup();$('barcode-status').textContent='적용을 누르면 제품 정보를 조회해요.';$('product-lookup-details').textContent='';changed({clearQuantity:true});});
  $('product-barcode').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('barcode-apply').click();}});
  for(const [key,id] of Object.entries(fields))$(id).addEventListener('input',()=>{
    if(['name','strength','manufacturer'].includes(key)){
      if(lookupPending)stopLookup();
      $('barcode-status').textContent='직접 입력한 제품 정보예요. 현재 포장과 대조해 주세요.';
      $('product-lookup-details').textContent='';
    }
    if(key==='size'){if($('label-size').value==='dk22210')$('label-width').value=29;savePaper();}
    changed();
  });
  for(const id of ['label-width','label-height'])$(id).addEventListener('input',()=>{savePaper();changed();});
  $('label-reviewed').onchange=render;
  $('dispense-form').onsubmit=event=>{
    event.preventDefault();
    try{applyBarcode();}catch(error){$('barcode-status').textContent=error.message;return;}
    if(lookupPending||!$('dispense-form').reportValidity())return;
    remember();count=null;changed();
    $('dispense-count-product').textContent=$('product-name').value;
    startCounting();
  };
  connection=printConnection({onChange:render,onOpenDispensing:openDispensing,getPaperSettings:paperSettings});
  async function trackJob(job) {
    if(sendJob!==job)return;
    try {
      const status=await connection.status(job.id);
      if(sendJob!==job)return;
      $('label-send-status').textContent=({waiting:'PC로 전송했어요. PC 출력 대기 화면에서 라벨을 확인해 주세요.',printed:'PC에서 실제 출력 완료를 확인했어요.',dismissed:'PC에서 이 라벨 요청을 취소했어요.'})[status.status]||'PC의 확인을 기다리고 있어요.';
      if(status.status==='printed'||status.status==='dismissed')return;
    }catch(error){if(sendJob===job)$('label-send-status').textContent=`전송한 요청의 상태를 확인하지 못했어요. ${error.message}`;if(error.status===410)return;}
    if(sendJob===job)statusTimer=setTimeout(()=>void trackJob(job),8000);
  }
  $('label-send').onclick=async()=>{
    if(sending||sendJob?.submitted)return;
    const data=labelData();if(labelIssues(data).length||!$('label-reviewed').checked)return;
    const fingerprint=JSON.stringify(data);
    if(!sendJob||sendJob.fingerprint!==fingerprint)sendJob={id:crypto.randomUUID(),fingerprint,submitted:false};
    const job=sendJob;sending=true;render();
    try {
      await connection.send(data,job.id);
      if(sendJob!==job)return;
      job.submitted=true;remember();$('label-send-status').textContent='PC로 전송했어요. PC에서 출력할 수 있어요.';void trackJob(job);
    }catch(error){if(sendJob===job)$('label-send-status').textContent=`${error.message} 같은 전송 버튼으로 다시 시도해 주세요.`;}
    finally{sending=false;render();}
  };
  $('label-print-local').onclick=()=>{
    const data=labelData();if(labelIssues(data).length||!$('label-reviewed').checked)return;
    try{printLabel(data);remember();$('label-send-status').textContent='인쇄 창을 열었어요. 실제 출력 여부는 프린터에서 확인해 주세요.';}
    catch(error){$('label-send-status').textContent=error.message;}
  };
  $('dispense-new').onclick=()=>{
    if((count!==null||$('product-name').value)&&!window.confirm('현재 라벨 입력을 비우고 다음 소분을 시작할까요? 이미 PC에 보낸 요청은 그대로 남아요.'))return;
    const paper=paperSettings();stopLookup();$('product-lookup-details').textContent='';product=null;count=null;$('dispense-form').reset();$('label-size').value=paper.size;$('label-width').value=paper.widthMm;$('label-height').value=paper.heightMm;$('packed-on').value=localDate();changed({clearQuantity:true});
    $('barcode-status').textContent='다음 제품의 바코드를 읽어 주세요.';$('product-barcode').focus();
  };
  $('dispense-return').onclick=openDispensing;
  window.addEventListener('resize',()=>{if(!$('dispense-panel').hidden)render();});
  window.addEventListener('pagehide',()=>clearTimeout(statusTimer));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&sendJob?.submitted){clearTimeout(statusTimer);void trackJob(sendJob);}});
  render();
  return {
    show(){render();connection.refresh();},
    stopScanner(){scanner.stop();if($('barcode-dialog').open)$('barcode-dialog').close();},
    acceptCount(value){if(!validCount(value))return false;count=value;changed();return true;},
    productName:()=>$('product-name').value,
    closeDialog(){for(const id of ['barcode-dialog','printer-dialog','received-label-dialog'])if($(id).open){$(id).close();return true;}return false;}
  };
}
