// Suppress a large region enclosing several distinct pill detections (e.g. a cup).
// Uses model boxes only: target counts and ground-truth annotations are never inputs.
export function suppressContainerDetections(objects,enabled=true){
 if(!enabled)return {objects:[...objects],excluded:[]};
 const area=o=>o.bbox[2]*o.bbox[3];
 const intersection=(a,b)=>Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1]));
 const excluded=[];
 for(const parent of objects){
  const parentArea=area(parent);if(!(parentArea>0))continue;
  const children=objects.filter(child=>child!==parent&&area(child)>0&&area(child)<=parentArea/6&&intersection(parent.bbox,child.bbox)/area(child)>=.9).sort((a,b)=>(b.confidence??0)-(a.confidence??0));
  const distinct=[];
  for(const child of children){if(distinct.every(other=>{const overlap=intersection(child.bbox,other.bbox);return overlap/(area(child)+area(other)-overlap)<.5;}))distinct.push(child);}
  if(distinct.length<4)continue;
  const areas=distinct.map(area).sort((a,b)=>a-b),median=areas[Math.floor(areas.length/2)];
  if(parentArea>=median*8)excluded.push(parent);
 }
 const removed=new Set(excluded);
 return {objects:objects.filter(o=>!removed.has(o)),excluded};
}
