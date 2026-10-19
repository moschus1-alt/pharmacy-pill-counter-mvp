import {buildModelDownload} from './scripts/build-model-download.mjs';
import {cp,mkdir,rm,access} from 'node:fs/promises';
import {dirname} from 'node:path';
if(process.env.VERCEL==='1'){
 try{await access('private-model/counter-model.tflite');}
 catch{throw new Error('Deployment requires private-model/counter-model.tflite. Preserve the existing private model when deploying UI changes.');}
}
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
await cp('dispensing.css','dist/dispensing.css');
for(const path of ['integrations/upharm-daily.zip','integrations/upharm-daily/README.md','integrations/upharm-daily/CODEX_HANDOFF.md','integrations/upharm-daily/pill_counter_relay.py','index.html','model.html','model.css','src/model-store.js','src/model-download.js','exit.html','style.css','src/app.js','src/pc-view.js','src/zip-store.js','integrations/pc-printer','src/image-detector.js','src/camera-frame.js','src/photo-gestures.js','src/app-navigation.js','src/dispensing.js','src/dispensing-view.js','src/dispensing-data.js','src/product-code.js','src/barcode-scanner.js','src/label-view.js','src/print-connection.js','vendor/zxing-browser.min.js','vendor/JsBarcode.code128.min.js','vendor/qrcode.js','examples','licenses']){
 await mkdir(dirname(`dist/${path}`),{recursive:true});
 await cp(path,`dist/${path}`,{recursive:true,filter:source=>!source.split(/[\\/]/).includes('__pycache__')});
}
await cp('private-model/preprocess-profile.json','dist/private-model-profile.json');
let haveModel=false;try{await access('private-model/counter-model.tflite');haveModel=true;}catch{}
if(haveModel){const model=await buildModelDownload('private-model/counter-model.tflite','dist/model-download');console.log(`Model download built: ${model.bytes} bytes, ${model.parts.length} verified parts`);}
console.log('Static UI built; the server model is also offered as a verified download.');
