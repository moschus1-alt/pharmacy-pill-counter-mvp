// Small uncompressed ZIP writer. Connection credentials stay in this browser.
export function zipStore(entries) {
  const encoder=new TextEncoder(),parts=[],central=[];let offset=0;
  function header(size){const bytes=new Uint8Array(size);return {bytes,view:new DataView(bytes.buffer)};}
  for(const [path,value] of entries){
    const name=encoder.encode(path),data=typeof value==='string'?encoder.encode(value):value;
    let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
    const local=header(30);local.view.setUint32(0,0x04034b50,true);local.view.setUint16(4,20,true);local.view.setUint16(6,0x800,true);local.view.setUint32(14,crc,true);local.view.setUint32(18,data.length,true);local.view.setUint32(22,data.length,true);local.view.setUint16(26,name.length,true);
    const item=header(46);item.view.setUint32(0,0x02014b50,true);item.view.setUint16(4,20,true);item.view.setUint16(6,20,true);item.view.setUint16(8,0x800,true);item.view.setUint32(16,crc,true);item.view.setUint32(20,data.length,true);item.view.setUint32(24,data.length,true);item.view.setUint16(28,name.length,true);item.view.setUint32(42,offset,true);
    parts.push(local.bytes,name,data);central.push(item.bytes,name);offset+=30+name.length+data.length;
  }
  const end=header(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,entries.length,true);end.view.setUint16(10,entries.length,true);end.view.setUint32(12,central.reduce((n,b)=>n+b.length,0),true);end.view.setUint32(16,offset,true);
  return new Blob([...parts,...central,end.bytes],{type:'application/zip'});
}
