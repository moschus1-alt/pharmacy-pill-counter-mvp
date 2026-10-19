import {dispensingView,dispensingDialogs} from './dispensing-view.js';
import {parseProductBarcode,localDate,labelIssues,validCount} from './dispensing-data.js';
import {createLabel,labelFits,printLabel} from './label-view.js';
import {barcodeScanner} from './barcode-scanner.js';
import {printConnection} from './print-connection.js';

export function setupDispensing({startCounting,cancelCounting,openDispensing}) {
  const $=id=>document.getElementById(id),catalogKey='pill-products-v1';
  document.querySelector('.tabs').insertAdjacentHTML('beforeend','<button id="dispense-tab" aria-pressed="false">의약품예제소분</button>');
  document.querySelector('footer').insertAdjacentHTML('beforebegin',dispensingView);
  document.body.insertAdjacentHTML('beforeend',dispensingDialogs);
  document.querySelector('.counter').before($('dispense-count-banner'));
  let product=null,count=null,connection=null,sending=false,sendJob=null,statusTimer=null;
  const fields={name:'product-name',strength:'product-strength',manufacturer:'product-manufacturer',lot:'product-lot',expiry:'product-expiry',packedOn:'packed-on',useBy:'use-by',size:'label-size',copies:'label-copies'};
  let catalog={};try{catalog=JSON.parse(localStorage.getItem(catalogKey)||'{}');if(!catalog||typeof catalog!=='object'||Array.isArray(catalog))catalog={};}catch{ /* Continue without a saved catalog. */ }
  $('packed-on').value=localDate();
  function labelData() {
    const data={code:product?.code||'',count};
    for(const [key,id] of Object.entries(fields))data[key]=$(id).value.trim();
    data.copies=Number(data.copies);return data;
  }
  function clearSent(){clearTimeout(statusTimer);sendJob=null;$('label-send-status').textContent='';}
  function changed({clearQuantity=false}={}) {
    $('label-reviewed').checked=false;clearSent();
    if(clearQuantity){count=null;cancelCounting();}
    render();
  }
  function applyBarcode() {
    const parsed=parseProductBarcode($('product-barcode').value);
    if(product?.raw===parsed.raw)return;
    product=parsed;
    const saved=Object.hasOwn(catalog,parsed.code)?catalog[parsed.code]:null;
    for(const key of ['name','strength','manufacturer'])$(fields[key]).value=typeof saved?.[key]==='string'?saved[key]:'';
    $('product-lot').value=parsed.lot;$('product-expiry').value=parsed.expiry;
    $('use-by').value='';$('packed-on').value=localDate();
    $('barcode-status').textContent=saved?'이 기기에 저장한 제품을 불러왔어요. 현재 포장과 대조해 주세요.':'새 제품이에요. 포장의 제품명을 입력해 주세요.';
    if(parsed.lot||parsed.expiry)$('barcode-status').textContent+=' 바코드의 제조번호·사용기한도 확인해 주세요.';
    changed({clearQuantity:true});
  }
  function remember() {
    if(!$('remember-product').checked||!product)return;
    const data=labelData();
    Object.defineProperty(catalog,product.code,{value:{name:data.name,strength:data.strength,manufacturer:data.manufacturer},enumerable:true,configurable:true,writable:true});
    // Keep the catalog bounded on shared tablets/phones.
    const entries=Object.entries(catalog).slice(-500);catalog=Object.fromEntries(entries);
    try{localStorage.setItem(catalogKey,JSON.stringify(catalog));}catch{$('barcode-status').textContent='기기 저장 공간을 사용할 수 없어요. 이번 라벨은 계속 만들 수 있어요.';}
  }
  function render() {
    for(const id of [...Object.values(fields),'product-barcode','remember-product','label-reviewed','barcode-open','barcode-apply','dispense-start-count','dispense-new'])$(id).disabled=sending;
    const data=labelData(),paper=createLabel(data);
    $('label-preview').replaceChildren(paper);
    const issues=labelIssues(data);
    if(product?.raw!==$('product-barcode').value.trim().replace(/^\](?:C1|d2|Q3)/,''))issues.unshift('입력한 바코드를 적용해 주세요.');
    // Hidden tabs have no layout; check again when the tab becomes visible.
    if(!$('dispense-panel').hidden&&!labelFits(paper))issues.push('내용이 라벨 크기를 넘어가요. 큰 라벨을 선택하거나 제품명·함량을 줄여 주세요.');
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
  $('barcode-apply').onclick=()=>{try{applyBarcode();}catch(error){$('barcode-status').textContent=error.message;}};
  $('product-barcode').addEventListener('input',()=>changed({clearQuantity:true}));
  $('product-barcode').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('barcode-apply').click();}});
  for(const id of Object.values(fields))$(id).addEventListener('input',()=>changed());
  $('label-reviewed').onchange=render;
  $('dispense-form').onsubmit=event=>{
    event.preventDefault();
    try{applyBarcode();}catch(error){$('barcode-status').textContent=error.message;return;}
    if(!$('dispense-form').reportValidity())return;
    remember();count=null;changed();
    $('dispense-count-product').textContent=$('product-name').value;
    startCounting();
  };
  connection=printConnection({onChange:render,onOpenDispensing:openDispensing});
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
    product=null;count=null;$('dispense-form').reset();$('packed-on').value=localDate();changed({clearQuantity:true});
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
