// A real GS1 DataMatrix fixture with leading FNC1 codeword 232, not just a
// pre-decoded test string. Use ZXing ECC200 and placement after ASCII encoding.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const Writer=require('@zxing/library/cjs/core/datamatrix/DataMatrixWriter').default;
const {SymbolInfo,ErrorCorrection,DefaultPlacement}=require('@zxing/library/cjs/core/datamatrix/encoder');
export function gs1Matrix(text) {
  const words=[232];
  for(let i=0;i<text.length;i++) {
    if(/^\d{2}$/.test(text.slice(i,i+2))){words.push(130+Number(text.slice(i,i+2)));i++;}
    else if(text.charCodeAt(i)===29)words.push(232);
    else {if(text.charCodeAt(i)>127)throw Error('Fixture supports ASCII only');words.push(text.charCodeAt(i)+1);}
  }
  const info=SymbolInfo.lookup(words.length);
  if(words.length<info.dataCapacity)words.push(129);
  while(words.length<info.dataCapacity){const pad=129+((149*(words.length+1))%253)+1;words.push(pad<=254?pad:pad-254);}
  const codewords=ErrorCorrection.encodeECC200(String.fromCharCode(...words),info);
  const placement=new DefaultPlacement(codewords,info.getSymbolDataWidth(),info.getSymbolDataHeight());placement.place();
  const matrix=new Writer().encodeLowLevel(placement,info,0,0);
  return Array.from({length:matrix.getHeight()},(_,y)=>Array.from({length:matrix.getWidth()},(_,x)=>matrix.get(x,y)));
}
