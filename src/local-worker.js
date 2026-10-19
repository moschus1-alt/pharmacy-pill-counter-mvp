// Classic worker is required by upstream LiteRT's importScripts WASM loader.
let runtime,model,algorithm,backend;
const status=text=>postMessage({type:'status',text});
onmessage=async({data})=>{
 try{
  if(data.type==='init'){
   const started=performance.now();backend=data.backend;
   status('인식 엔진을 준비하고 있어요…');
   const [rt,math,store]=await Promise.all([import('/vendor/litert-2.5.3/index.js'),import('./local-inference.js'),import('./model-store.js')]);runtime=rt;algorithm=math;
   if(backend==='webgpu'&&(!navigator.gpu||!await navigator.gpu.requestAdapter()))throw Error('이 브라우저에서는 GPU를 사용할 수 없어요. CPU로 바꿔 주세요.');
   const db=await store.openModelStore();let bytes;
   try{
    const manifest=store.validateManifest(data.manifest);
    bytes=new Uint8Array(await (await store.downloadModel(manifest,db,{onProgress:(done,total)=>postMessage({type:'progress',done,total})})).arrayBuffer());
   }finally{db.close();}
   status('모델을 불러오고 있어요. 첫 실행은 조금 걸려요…');
   self.Module={locateFile:path=>new URL('/vendor/litert-2.5.3/wasm/'+path,self.location.origin).href};
   await runtime.loadLiteRt('/vendor/litert-2.5.3/wasm/',{jspi:backend==='webgpu'&&await runtime.supportsFeature('jspi')});
   model=await runtime.loadAndCompile(bytes,{accelerator:backend,gpuOptions:{precision:'fp32'}});
   const input=model.getInputDetails()[0],output=model.getOutputDetails()[0];
   if(input?.dtype!=='float32'||JSON.stringify(Array.from(input?.shape||[]))!==JSON.stringify([1,832,832,3])||output?.dtype!=='float32'||JSON.stringify(Array.from(output?.shape||[]))!==JSON.stringify([1,5,14196]))throw Error('모델 입출력 형식이 예상과 달라요.');
   postMessage({type:'ready',initMs:performance.now()-started,backend,fullyAccelerated:model.isFullyAccelerated,input,output});
  }else if(data.type==='run'){
   if(!model)throw Error('먼저 모델을 준비해 주세요.');
   const started=performance.now();status('이 기기에서 알약을 찾고 있어요…');
   const tensorData=algorithm.prepareInput(data.image),prepared=performance.now();
   let tensor,outputs;
   try{
    tensor=new runtime.Tensor(tensorData,[1,832,832,3]);
    outputs=await model.run(tensor);
    const raw=await outputs[0].data();
    const inferred=performance.now(),objects=algorithm.postprocess(raw,data.image.width,data.image.height);
    postMessage({type:'result',objects,timings:{preprocessMs:prepared-started,inferenceMs:inferred-prepared,postprocessMs:performance.now()-inferred,totalMs:performance.now()-started},backend});
   }finally{tensor?.delete();outputs?.forEach(t=>t.delete());}
  }
 }catch(error){postMessage({type:'error',message:error?.message||String(error)});}
};
