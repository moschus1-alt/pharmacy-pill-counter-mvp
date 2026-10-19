import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
// Pinned upstream ESM package has one bare import. Resolve it locally so the
// classic inference worker can dynamically import it without an import map/CDN.
export async function buildLiteRT(){
 const target='dist/vendor/litert-2.5.3';
 await mkdir(target,{recursive:true});
 const core=await readFile('node_modules/@litertjs/core/dist/index.js','utf8');
 if(!core.includes('from "@litertjs/wasm-utils"'))throw Error('LiteRT import contract changed');
 await writeFile(`${target}/index.js`,core.replace('from "@litertjs/wasm-utils"','from "./wasm-utils.js"'));
 await cp('node_modules/@litertjs/wasm-utils/dist/index.js',`${target}/wasm-utils.js`);
 await cp('node_modules/@litertjs/core/wasm',`${target}/wasm`,{recursive:true});
}
