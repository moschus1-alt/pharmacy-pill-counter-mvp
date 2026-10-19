export const LABEL_SIZES = Object.freeze({'60x40':[60,40], '70x50':[70,50], '50x30':[50,30], '62x29':[62,29], '62x100':[62,100], '29x90':[29,90]});

function validPaperDimension(value) {return typeof value==='number'&&Number.isFinite(value)&&value>=12&&value<=200&&Math.abs(value*10-Math.round(value*10))<1e-6;}

export function labelDimensions(data) {
  if(data.size==='dk22210') {
    if(data.widthMm!==29||!validPaperDimension(data.heightMm))return null;
    return [29,data.heightMm];
  }
  if(data.size!=='custom')return Object.hasOwn(LABEL_SIZES,data.size)?LABEL_SIZES[data.size]:null;
  const {widthMm,heightMm}=data;
  if(![widthMm,heightMm].every(validPaperDimension))return null;
  return [widthMm,heightMm];
}
export function labelSizeText(data) {
  const size=labelDimensions(data);return size?`${data.size==='dk22210'?'DK-22210 · ':''}${size[0]} × ${size[1]} mm`:'용지 크기를 확인해 주세요';
}

// Print the trade name without parenthetical ingredients or underscore separators.
// Keep the original lookup/form value available for product verification.
export function labelProductName(value) {
  let depth=0,result='';
  for(const char of String(value??'')) {
    if(char==='('||char==='（'){depth++;continue;}
    if(char===')'||char==='）'){depth=Math.max(0,depth-1);continue;}
    if(!depth&&char!=='_'&&char!=='＿')result+=char;
  }
  return result.replace(/\s+/g,' ').trim();
}

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

export function gs1Expiry(value) {
  if (!/^\d{6}$/.test(value)) return '';
  const year=2000+Number(value.slice(0,2)), month=Number(value.slice(2,4)), day=Number(value.slice(4));
  if (month<1 || month>12) return '';
  const last=new Date(year,month,0).getDate();
  if (day>last) return '';
  return `${year}-${String(month).padStart(2,'0')}-${String(day||last).padStart(2,'0')}`;
}

// ZXing returns the leading GS1 FNC1 as ASCII GS (29). Native decoders may
// omit it or include an AIM identifier. Keep internal GS separators intact.
export function barcodePayload(input) {
  return String(input).trim().replace(/^\](?:C1|d2|Q3)/,'').replace(/^\x1d+(?=01\d{14})/,'');
}

// Only decode known GS1 application identifiers. Never guess an AI inside a
// variable-length lot/serial number; FNC1 is required to delimit those fields.
export function parseProductBarcode(input) {
  const raw=barcodePayload(input);
  if (!raw || raw.length>200) throw Error('바코드를 200자 이내로 입력해 주세요.');
  const fields={};
  if (/^\(\d{2,4}\)/.test(raw)) {
    for (const match of raw.matchAll(/\((\d{2,4})\)([^()]*)/g)) fields[match[1]]=match[2];
  } else if (/^01\d{14}/.test(raw) && raw.length>16) {
    let rest=raw;
    while (rest) {
      rest=rest.replace(/^\x1d+/,'');
      const ai=rest.slice(0,2); rest=rest.slice(2);
      const length=({ '01':14, '11':6, '15':6, '17':6 })[ai];
      if (length) { if (rest.length<length) break; fields[ai]=rest.slice(0,length); rest=rest.slice(length); }
      else if (ai==='10'||ai==='21') { const end=rest.indexOf('\x1d'); fields[ai]=end<0?rest:rest.slice(0,end); rest=end<0?'':rest.slice(end+1); }
      else break;
    }
  } else if (/^01\d{14}$/.test(raw)) fields['01']=raw.slice(2);
  const code=fields['01']||raw;
  if (!/^[\x20-\x7e]+$/.test(code) || code.length>100) throw Error('지원하는 제품 바코드가 아니에요. 포장의 숫자 바코드를 입력해 주세요.');
  return {raw,code,lot:(fields['10']||'').slice(0,40),expiry:gs1Expiry(fields['17']||'')};
}

export function validCount(value) {return Number.isSafeInteger(value)&&value>0&&value<=99999;}

export function labelIssues(data) {
  const issues=[];
  if (!data.code || !data.name.trim()) issues.push('바코드와 제품명을 입력해 주세요.');
  if (data.name.length>80||data.strength.length>40||data.manufacturer.length>60) issues.push('제품명은 80자, 함량·규격은 40자, 제조·수입사는 60자 이내로 라벨에 맞게 입력해 주세요.');
  if (!validCount(data.count)) issues.push('알약을 카운팅하고 수량 확인을 완료해 주세요.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.packedOn)) issues.push('소분일을 입력해 주세요.');
  if (data.expiry && data.expiry<data.packedOn) issues.push('제품 사용기한이 소분일보다 이전이에요. 포장을 다시 확인해 주세요.');
  if (data.useBy && data.useBy<data.packedOn) issues.push('소분 후 사용기한은 소분일 이후로 입력해 주세요.');
  if (data.expiry && data.useBy && data.useBy>data.expiry) issues.push('소분 후 사용기한이 제품 사용기한을 넘을 수 없어요.');
  if (!labelDimensions(data)) issues.push('라벨 폭·길이는 각각 12~200 mm, 소수점 한 자리 이내로 입력해 주세요.');
  if (!Number.isInteger(data.copies)||data.copies<1||data.copies>20) issues.push('출력 매수는 1~20장으로 입력해 주세요.');
  return issues;
}
