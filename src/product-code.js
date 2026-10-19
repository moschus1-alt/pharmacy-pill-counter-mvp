// Only a leading zero is padding. A nonzero GTIN-14 packaging indicator must
// never be stripped or converted to a different pack's code.
export function normalizeProductCode(value) {
  const code=String(value).trim();
  if(!/^\d{13,14}$/.test(code))return null;
  const sum=[...code].reverse().reduce((sum,digit,index)=>sum+Number(digit)*(index%2?3:1),0);
  if(sum%10)return null;
  return code.length===14&&code[0]==='0'?code.slice(1):code;
}
