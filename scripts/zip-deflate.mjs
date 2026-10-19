import {deflateRawSync} from 'node:zlib';
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
// Build-time compressed ZIP; paths are our bundled files, never user input.
export function zipDeflate(entries){
 const encoder=new TextEncoder(),parts=[],central=[];let offset=0;
 const header=n=>{const bytes=new Uint8Array(n);return {bytes,view:new DataView(bytes.buffer)};};
 for(const [path,value] of entries){
  const name=encoder.encode(path),data=typeof value==='string'?encoder.encode(value):value,packed=deflateRawSync(data,{level:6});
  let crc=0xffffffff;for(const byte of data)crc=(crc>>>8)^table[(crc^byte)&255];crc=(crc^0xffffffff)>>>0;
  const local=header(30),a=local.view;a.setUint32(0,0x04034b50,true);a.setUint16(4,20,true);a.setUint16(6,0x800,true);a.setUint16(8,8,true);a.setUint16(12,((2026-1980)<<9)|33,true);a.setUint32(14,crc,true);a.setUint32(18,packed.length,true);a.setUint32(22,data.length,true);a.setUint16(26,name.length,true);
  const item=header(46),b=item.view;b.setUint32(0,0x02014b50,true);b.setUint16(4,20,true);b.setUint16(6,20,true);b.setUint16(8,0x800,true);b.setUint16(10,8,true);b.setUint16(14,((2026-1980)<<9)|33,true);b.setUint32(16,crc,true);b.setUint32(20,packed.length,true);b.setUint32(24,data.length,true);b.setUint16(28,name.length,true);b.setUint32(42,offset,true);
  parts.push(local.bytes,name,packed);central.push(item.bytes,name);offset+=30+name.length+packed.length;
 }
 const end=header(22),v=end.view;v.setUint32(0,0x06054b50,true);v.setUint16(8,entries.length,true);v.setUint16(10,entries.length,true);v.setUint32(12,central.reduce((n,b)=>n+b.length,0),true);v.setUint32(16,offset,true);
 return new Blob([...parts,...central,end.bytes],{type:'application/zip'});
}
