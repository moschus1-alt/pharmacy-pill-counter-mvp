import {cp,mkdir,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
for(const path of ['index.html','style.css','src/app.js','src/image-detector.js','src/camera-frame.js','src/photo-gestures.js','src/app-navigation.js','examples','licenses']){
 await mkdir(dirname(`dist/${path}`),{recursive:true});
 await cp(path,`dist/${path}`,{recursive:true});
}
console.log('Static UI built; private model is only included in the Python function.');
