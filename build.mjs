import {buildLiteRT} from './scripts/build-litert.mjs';
import {buildModelDownload} from './scripts/build-model-download.mjs';
import {cp,mkdir,rm,access,readFile,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
if(process.env.VERCEL==='1'){
 try{await access('private-model/counter-model.tflite');}
 catch{throw new Error('Deployment requires private-model/counter-model.tflite. Preserve the existing private model when deploying UI changes.');}
}
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
await cp('dispensing.css','dist/dispensing.css');
for(const path of ['integrations/upharm-daily.zip','integrations/upharm-daily/README.md','integrations/upharm-daily/CODEX_HANDOFF.md','integrations/upharm-daily/pill_counter_relay.py','src/local-detector.js','src/local-worker.js','src/local-inference.js','index.html','model.html','model.css','src/model-store.js','src/model-download.js','exit.html','style.css','src/app.js','src/pc-view.js','src/zip-store.js','integrations/pc-printer','src/image-detector.js','src/camera-frame.js','src/photo-gestures.js','src/app-navigation.js','src/dispensing.js','src/dispensing-view.js','src/dispensing-data.js','src/product-code.js','src/barcode-scanner.js','src/label-view.js','src/print-connection.js','vendor/zxing-browser.min.js','vendor/JsBarcode.code128.min.js','vendor/qrcode.js','examples','licenses']){
 await mkdir(dirname(`dist/${path}`),{recursive:true});
 await cp(path,`dist/${path}`,{recursive:true,filter:source=>!source.split(/[\\/]/).includes('__pycache__')});
}
await cp('private-model/preprocess-profile.json','dist/private-model-profile.json');
let haveModel=false;try{await access('private-model/counter-model.tflite');haveModel=true;}catch{}
if(haveModel){const model=await buildModelDownload('private-model/counter-model.tflite','dist/model-download');console.log(`Model download built: ${model.bytes} bytes, ${model.parts.length} verified parts`);}
console.log('Static UI built; the server model is also offered as a verified download.');

await buildLiteRT();

// Use the exact same counter UI for on-device inference; keep the old shared
// test-page URL working without the retired comparison interface.
const localPage=(await readFile('index.html','utf8'))
 .replace('<body>','<body data-inference="local">')
 .replace('<title>알약 카운터</title>','<title>알약 카운터 · 휴대폰 인식</title>')
 .replace('class="brand" href="./"','class="brand" href="local.html"')
 .replace('한눈에, 정확하게 확인','휴대폰에서 바로 인식')
 .replace('href="local.html">휴대폰 인식</a>','href="./">기존 카운터</a>');
await writeFile('dist/local.html',localPage);
await writeFile('dist/local-test.html',localPage);
