import {LABEL_SIZES,labelDimensions,labelProductName} from './dispensing-data.js';

function element(tag,text,className='') {
  const node=document.createElement(tag);node.textContent=text;node.className=className;return node;
}
export function createLabel(data,{test=false}={}) {
  const size=labelDimensions(data)||LABEL_SIZES['60x40'];
  const paper=element('article','','label-paper');
  paper.style.setProperty('--label-width',`${size[0]}mm`);
  paper.style.setProperty('--label-height',`${size[1]}mm`);
  paper.classList.toggle('label-small',size[0]<=50||size[1]<=30);
  paper.classList.toggle('label-narrow',size[0]<=29);
  paper.classList.toggle('label-brother',data.size==='dk22210'||['62x29','62x100','29x90'].includes(data.size));
  const heading=element('div','','label-heading');
  heading.append(element('span',test?'프린터 테스트':'의약품 예제소분'),element('strong',`${data.count??'—'}개`));
  paper.append(heading,element('h3',labelProductName(data.name)||'제품명을 입력해 주세요','label-product'));
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
      svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('role','img');svg.setAttribute('aria-label',`제품 바코드 ${data.code}`);wrap.append(svg);
    }catch{ /* The human-readable product code remains available. */ }
    wrap.append(element('span',data.code));paper.append(wrap);
  }
  const content=element('div','','label-content');
  content.append(...paper.childNodes);paper.append(content);
  queueMicrotask(()=>fitLabel(paper));
  return paper;
}

export function fitLabel(node) {
  const content=node.querySelector('.label-content');
  if(!content||!node.clientHeight)return 1;
  const style=getComputedStyle(node),width=node.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),height=node.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
  content.style.transform='none';content.style.minHeight='0';content.style.marginLeft='0';
  function fits(scale){
    content.style.width=`${width/scale}px`;
    return Math.max(content.scrollHeight,content.getBoundingClientRect().height)*scale<=height+.01;
  }
  let scale=1;
  if(!fits(1)){
    let low=.001,high=1;
    for(let i=0;i<14;i++){const middle=(low+high)/2;if(fits(middle))low=middle;else high=middle;}
    scale=low;
  }
  content.style.width=`${width/scale}px`;
  content.style.minHeight=`${height/scale}px`;
  content.style.transform=`scale(${scale})`;
  node.dataset.scale=String(scale);
  return scale;
}
export function labelFits(node) {
  fitLabel(node);
  return !node.clientHeight||Number(node.dataset.scale)>0;
}

export function printLabel(data,{test=false}={}) {
  const region=document.getElementById('label-print-area');
  region.replaceChildren(...Array.from({length:test?1:data.copies},()=>createLabel(data,{test})));
  const size=labelDimensions(data);
  if(!size)throw Error('용지 폭·길이를 확인해 주세요.');
  const [width,height]=size;
  document.getElementById('label-page-style').textContent=`@page { size: ${width}mm ${height}mm; margin: 0; }`;
  // Use the same fit-to-paper layout in the preview and browser print output.
  region.classList.add('print-measuring');
  const fits=[...region.children].every(labelFits);
  region.classList.remove('print-measuring');
  if(!fits)throw Error('용지 크기를 확인해 주세요.');
  window.print();
}
