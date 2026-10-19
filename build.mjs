import {cp,mkdir,rm,access} from 'node:fs/promises';
import {dirname} from 'node:path';
if(process.env.VERCEL==='1'){
 try{await access('private-model/counter-model.tflite');}
 catch{throw new Error('Deployment requires private-model/counter-model.tflite. Preserve the existing private model when deploying UI changes.');}
}
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
await cp('dispensing.css','dist/dispensing.css');
for(const path of ['index.html','style.css','src/app.js','src/image-detector.js','src/camera-frame.js','src/photo-gestures.js','src/app-navigation.js','src/dispensing.js','src/dispensing-view.js','src/dispensing-data.js','src/product-code.js','src/barcode-scanner.js','src/label-view.js','src/print-connection.js','vendor/zxing-browser.min.js','vendor/JsBarcode.code128.min.js','vendor/qrcode.js','examples','licenses']){
 await mkdir(dirname(`dist/${path}`),{recursive:true});
 await cp(path,`dist/${path}`,{recursive:true});
}
console.log('Static UI built; private model is only included in the Python function.');
