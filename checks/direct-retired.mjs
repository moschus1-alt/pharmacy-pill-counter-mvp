import assert from 'node:assert/strict';
import handler from '../api/print-relay.js';
const original=globalThis.fetch;let requests=0;
globalThis.fetch=()=>{requests++;throw Error('No network permitted');};
try{
 for(const method of ['GET','POST'])for(const action of ['create','jobs','receiver-heartbeat','submit','status','connection']){
  let status,result;
  await handler({method,url:'/api/print-relay?action='+action,body:{action}},{setHeader(){},status(value){status=value;return this;},json(value){result=value;}});
  assert.equal(status,410);assert.equal(result.code,'DIRECT_CONNECTION_REQUIRED');
 }
 assert.equal(requests,0);
 console.log('PASS every old relay action returns 410 without network/Blob access');
}finally{globalThis.fetch=original;}
