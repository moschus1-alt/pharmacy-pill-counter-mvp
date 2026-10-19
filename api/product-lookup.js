import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {normalizeProductCode} from '../src/product-code.js';

let snapshot;
async function loadSnapshot() {
  if(!snapshot)snapshot=(async()=>{
    const [compressed,sourceText]=await Promise.all([
      readFile(new URL('../data/drug-catalog.json.gz',import.meta.url)),
      readFile(new URL('../data/drug-catalog-source.json',import.meta.url),'utf8')
    ]);
    const source=JSON.parse(sourceText);
    if(createHash('sha256').update(compressed).digest('hex')!==source.catalogSha256)throw Error('Catalog integrity check failed');
    return {entries:JSON.parse(gunzipSync(compressed)),source};
  })().catch(error=>{snapshot=null;throw error;});
  return snapshot;
}

export function lookupProduct(code,{entries,source}) {
  const normalized=normalizeProductCode(code);
  if(!normalized)return {status:'invalid'};
  const attribution={provider:source.provider,title:source.title,url:source.sourceUrl,asOf:source.asOf,license:source.license};
  const rows=Object.hasOwn(entries,normalized)?entries[normalized]:[];
  if(!rows.length)return {status:'not_found',code:normalized,source:attribution};
  if(rows.length!==1)return {status:'ambiguous',code:normalized,source:attribution};
  const [name,manufacturer,strength,packageQuantity,dosageForm,packageType,itemCode,cancelledOn,transferEndedOn]=rows[0];
  const product={code:normalized,name,manufacturer,strength:strength==='없음'?'':strength,packageQuantity,dosageForm,packageType,itemCode,cancelledOn,transferEndedOn};
  const endedAsOfSnapshot=[cancelledOn,transferEndedOn].some(date=>date&&date<=source.asOf);
  return {status:endedAsOfSnapshot?'historical':'found',code:normalized,product,source:attribution};
}

export default async function handler(req,res) {
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({status:'method_not_allowed'});}
  const params=new URL(req.url,'http://localhost').searchParams;
  const code=params.get('code')||'';
  if(params.getAll('code').length!==1||!normalizeProductCode(code))return res.status(400).json({status:'invalid'});
  try {
    const result=lookupProduct(code,await loadSnapshot());
    res.setHeader('Cache-Control','public, max-age=300, s-maxage=86400');
    return res.status(200).json(result);
  }catch{
    res.setHeader('Cache-Control','no-store');
    console.error('Medicine catalog unavailable');
    return res.status(503).json({status:'unavailable'});
  }
}
