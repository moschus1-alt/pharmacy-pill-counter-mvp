import {cp,mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for(const path of ['index.html','style.css','benchmark.html','src','vendor','models','examples','licenses','AI-비교보고서.txt','DEIM-개선-간단시험.txt']){
 await cp(path,`dist/${path}`,{recursive:true});
}
console.log('Static browser app built. Photos are processed on the device.');

// Bundle the pinned ONNX Runtime WebGPU library and matching JSEP WASM binaries.
await mkdir('dist/vendor/ort',{recursive:true});
for(const file of ['ort.webgpu.bundle.min.mjs','ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm']){
 await cp(`node_modules/onnxruntime-web/dist/${file}`,`dist/vendor/ort/${file}`);
}
