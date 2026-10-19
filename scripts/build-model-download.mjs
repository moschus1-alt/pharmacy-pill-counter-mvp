import {open,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

export const MODEL_SHA256='967308748ace08b219acb3913de40feac92fe71e1864892386b9475923a1275b';
export async function buildModelDownload(source,destination,{expectedHash=MODEL_SHA256,partBytes=4*1024*1024}={}) {
  const file=await open(source,'r'),hash=createHash('sha256'),parts=[];
  const version=expectedHash.slice(0,16),directory=join(destination,version);
  await mkdir(directory,{recursive:true});
  let total=0;
  try {
    while(true){
      const buffer=Buffer.alloc(partBytes);let filled=0;
      while(filled<partBytes){const result=await file.read(buffer,filled,partBytes-filled,null);if(!result.bytesRead)break;filled+=result.bytesRead;}
      if(!filled)break;
      const data=buffer.subarray(0,filled),name=`part-${String(parts.length).padStart(3,'0')}.bin`;
      hash.update(data);total+=filled;
      await writeFile(join(directory,name),data);
      parts.push({url:`/model-download/${version}/${name}`,bytes:filled,sha256:createHash('sha256').update(data).digest('hex')});
    }
  }finally{await file.close();}
  if(hash.digest('hex')!==expectedHash)throw Error('Model download hash mismatch');
  const manifest={schemaVersion:1,version,filename:'pill-counter-model.tflite',format:'TFLite',sha256:expectedHash,bytes:total,inputShape:[1,832,832,3],parts};
  await writeFile(join(destination,'manifest.json'),JSON.stringify(manifest));
  return manifest;
}
