import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {zipDeflate} from './zip-deflate.mjs';
const hash=data=>createHash('sha256').update(data).digest('hex');
export async function buildDirectPackage(){
 const manifest=JSON.parse(await readFile('integrations/direct-printer/runtime-manifest.json','utf8'));
 const entries=[],cache=process.env.DIRECT_RUNTIME_CACHE||'.test-results/direct-runtime';
 for(const item of manifest.files){
  let data;try{data=await readFile(`${cache}/${item.name}`);}catch{
   const response=await fetch(item.url,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('Could not fetch pinned Windows runtime');data=new Uint8Array(await response.arrayBuffer());
  }
  if(hash(data)!==item.sha256)throw Error(`Runtime integrity failed: ${item.name}`);
  entries.push([`runtime-assets/${item.name}`,data]);
 }
 async function tree(source,target,filter=()=>true){
  for(const entry of await readdir(source,{withFileTypes:true})){
   if(!filter(entry.name))continue;const path=`${source}/${entry.name}`,name=target?`${target}/${entry.name}`:entry.name;
   if(entry.isDirectory()){if(entry.name!=='__pycache__')await tree(path,name,filter);}else entries.push([name,new Uint8Array(await readFile(path))]);
  }
 }
 await tree('integrations/direct-printer','');
 for(const name of ['receiver.py','Print-Label.ps1','Barcode.ps1','JsBarcode-LICENSE.txt'])entries.push([name,new Uint8Array(await readFile(`integrations/pc-printer/${name}`))]);
 entries.push(['pill_counter_relay.py',new Uint8Array(await readFile('integrations/upharm-daily/pill_counter_relay.py'))]);
 await tree('dist','web',name=>!['integrations'].includes(name));
 for(const name of ['drug-catalog.json.gz','drug-catalog-source.json'])entries.push([`data/${name}`,new Uint8Array(await readFile('data/'+name))]);
 const zip=zipDeflate(entries);await mkdir('dist/integrations',{recursive:true});await writeFile('dist/integrations/pill-counter-direct.zip',new Uint8Array(await zip.arrayBuffer()));
 console.log(`Direct PC package: ${entries.length} files, ${zip.size} bytes (includes model and offline Windows runtime)`);
}
