// Float32 arithmetic and sampling follow detection_engine.py. Do not replace
// this with canvas drawImage resizing: its interpolation changes detections.
const f=Math.fround, size=832;
export function prepareInput({data,width,height}){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||Math.max(width,height)>2048||data.length!==width*height*4)throw Error('사진 크기가 올바르지 않아요.');
 const side=Math.max(width,height),left=Math.floor((side-width)/2),top=Math.floor((side-height)/2);
 const scale=f(side/size),step=Math.trunc(scale*2**32),start=Math.trunc(f(scale*.5)*2**32)-65536;
 const xs=Array.from({length:size},(_,i)=>Math.min(side-1,Math.max(0,Math.floor((i*step+start)/2**32)))-left);
 const out=new Float32Array(size*size*3);
 for(let y=0;y<size;y++){
  const sy=Math.min(side-1,Math.max(0,Math.floor(f(f(y+.5)*scale)-1/65536)))-top;
  if(sy<0||sy>=height)continue;
  for(let x=0;x<size;x++){
   const sx=xs[x];if(sx<0||sx>=width)continue;
   const source=(sy*width+sx)*4,dest=(y*size+x)*3,alpha=data[source+3];
   for(let c=0;c<3;c++){
    const value=width===height?data[source+c]:Math.floor((data[source+c]*alpha+127)/255);
    out[dest+c]=f(value/255);
   }
  }
 }
 return out;
}
export function postprocess(output,width,height,confidence=.5,iou=.6){
 if(output.length!==5*14196)throw Error('모델 출력 형식이 예상과 달라요.');
 const rows=[],n=14196;
 for(let i=0;i<n;i++){
  let cx=output[i],cy=output[n+i],bw=output[2*n+i],bh=output[3*n+i],score=output[4*n+i];
  if(bw>832||bh>832||(bw>cx&&bh>cy)){const x=cx,y=cy;cx=f(f(x+bw)/2);cy=f(f(y+bh)/2);bw=f(bw-x);bh=f(bh-y);}
  if(!Number.isFinite(score)||score<confidence||!(bw>f(.001)&&bh>f(.001)))continue;
  rows.push({i,cx,cy,bw,bh,score,x1:f(cx-f(bw*.5)),y1:f(cy-f(bh*.5)),x2:f(cx+f(bw*.5)),y2:f(cy+f(bh*.5))});
 }
 rows.sort((a,b)=>b.score-a.score||a.i-b.i);
 const keep=[];
 for(const box of rows){
  let suppressed=false;
  for(const other of keep){
   const iw=Math.max(0,f(Math.min(box.x2,other.x2)-Math.max(box.x1,other.x1))),ih=Math.max(0,f(Math.min(box.y2,other.y2)-Math.max(box.y1,other.y1)));
   const intersection=f(iw*ih),union=f(f(f(box.bw*box.bh)+f(other.bw*other.bh))-intersection);
   let overlap=union>f(1e-6)?f(intersection/union):0;if(!Number.isFinite(overlap))overlap=0;
   if(overlap>iou){suppressed=true;break;}
  }
  if(!suppressed){keep.push(box);if(keep.length===1000)break;}
 }
 const side=Math.max(width,height),left=Math.floor((side-width)/2),top=Math.floor((side-height)/2),factor=f(side/size),objects=[];
 for(const b of keep){
  const cx=f(b.cx*factor),cy=f(b.cy*factor),bw=f(b.bw*factor),bh=f(b.bh*factor);
  const x1=Math.max(0,f(f(f(cx-f(bw/2))*size)-left)),y1=Math.max(0,f(f(f(cy-f(bh/2))*size)-top));
  const x2=Math.min(width,f(f(f(cx+f(bw/2))*size)-left)),y2=Math.min(height,f(f(f(cy+f(bh/2))*size)-top));
  if(![x1,y1,x2,y2].every(Number.isFinite)||x2<=x1||y2<=y1)continue;
  const centerx=Math.min(width,Math.max(0,f(f(cx*size)-left))),centery=Math.min(height,Math.max(0,f(f(cy*size)-top)));
  const area=(x2-x1)*(y2-y1);
  objects.push({id:`pill-${b.i}`,queryIndex:b.i,x:f(centerx/width)*width,y:f(centery/height)*height,r:Math.sqrt(area/Math.PI),area,bbox:[x1,y1,x2-x1,y2-y1],confidence:b.score,source:'auto',needsReview:b.score<.65});
 }
 return objects;
}
export function compareResults(local,server){
 // Match by overlap, not only count or model query index (ties can select
 // different queries). Report both unmatched boxes and confidence differences.
 const overlap=(a,b)=>{const [x,y,w,h]=a,[u,v,s,t]=b;const area=Math.max(0,Math.min(x+w,u+s)-Math.max(x,u))*Math.max(0,Math.min(y+h,v+t)-Math.max(y,v));return area/(w*h+s*t-area)||0;};
 const pairs=[];local.forEach((a,i)=>server.forEach((b,j)=>{const value=overlap(a.bbox,b.bbox);if(value>=.5)pairs.push({i,j,value});}));pairs.sort((a,b)=>b.value-a.value);
 const usedLocal=new Set(),usedServer=new Set();let minIou=1,maxBoxDelta=0,maxConfidenceDelta=0;
 for(const {i,j,value} of pairs){if(usedLocal.has(i)||usedServer.has(j))continue;usedLocal.add(i);usedServer.add(j);minIou=Math.min(minIou,value);maxBoxDelta=Math.max(maxBoxDelta,...local[i].bbox.map((v,k)=>Math.abs(v-server[j].bbox[k])));maxConfidenceDelta=Math.max(maxConfidenceDelta,Math.abs(local[i].confidence-server[j].confidence));}
 return {matched:usedLocal.size,localOnly:local.length-usedLocal.size,serverOnly:server.length-usedServer.size,minIou:usedLocal.size?minIou:null,maxBoxDelta,maxConfidenceDelta};
}
