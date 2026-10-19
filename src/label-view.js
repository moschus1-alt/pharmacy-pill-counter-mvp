import {LABEL_SIZES} from './dispensing-data.js';

function element(tag,text,className='') {
  const node=document.createElement(tag);node.textContent=text;node.className=className;return node;
}
export function createLabel(data,{test=false}={}) {
  const size=LABEL_SIZES[data.size]||LABEL_SIZES['60x40'];
  const paper=element('article','','label-paper');
  paper.style.setProperty('--label-width',`${size[0]}mm`);
  paper.style.setProperty('--label-height',`${size[1]}mm`);
  paper.classList.toggle('label-small',data.size==='50x30');
  const heading=element('div','','label-heading');
  heading.append(element('span',test?'프린터 테스트':'의약품 예제소분'),element('strong',`${data.count??'—'}개`));
  paper.append(heading,element('h3',data.name||'제품명을 입력해 주세요','label-product'));
  if(data.strength)paper.append(element('p',data.strength,'label-strength'));
  const details=element('div','','label-details');
  if(data.lot)details.append(element('p',`제조번호 ${data.lot}`));
  details.append(element('p',`소분일 ${data.packedOn||'—'}`));
  if(data.expiry)details.append(element('p',`제품 사용기한 ${data.expiry}`));
  if(data.useBy)details.append(element('p',`소분 후 사용기한 ${data.useBy}`));
  paper.append(details);
  if(data.code) {
    const wrap=element('div','','label-barcode');
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    try {
      if(!window.JsBarcode)throw Error('Barcode renderer unavailable');
      window.JsBarcode(svg,data.code,{format:'CODE128',height:22,width:1.3,margin:0,displayValue:false});
      svg.setAttribute('role','img');svg.setAttribute('aria-label',`제품 바코드 ${data.code}`);wrap.append(svg);
    }catch{ /* The human-readable product code remains available. */ }
    wrap.append(element('span',data.code));paper.append(wrap);
  }
  return paper;
}

export function labelFits(node) {
  return node.scrollHeight<=node.clientHeight+1&&node.scrollWidth<=node.clientWidth+1;
}

export function printLabel(data,{test=false}={}) {
  const region=document.getElementById('label-print-area');
  region.replaceChildren(...Array.from({length:test?1:data.copies},()=>createLabel(data,{test})));
  const [width,height]=LABEL_SIZES[data.size];
  document.getElementById('label-page-style').textContent=`@page { size: ${width}mm ${height}mm; margin: 0; }`;
  // Lay out a real-size label before printing so long fields cannot silently clip.
  region.classList.add('print-measuring');
  const fits=[...region.children].every(labelFits);
  region.classList.remove('print-measuring');
  if(!fits)throw Error('내용이 라벨 크기를 넘어가요. 더 큰 라벨을 선택하거나 제품명·함량을 줄여 주세요.');
  window.print();
}
