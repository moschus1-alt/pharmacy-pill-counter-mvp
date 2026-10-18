// Only this viewport owns touch gestures; the rest of the page stays accessible.
export function photoGestures(stage,{zoomAt,panBy,getZoom,canMove,tap}){
 const points=new Map();let previous=null,moved=false,suppressUntil=0;
 const sample=()=>{
  const p=[...points.values()];
  return p.length>1?{x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2,d:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)}:{...p[0],d:0};
 };
 stage.addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse'&&e.button!==0)return;
  if(!points.size){moved=false;suppressUntil=0;}
  points.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY});previous=sample();
  if(points.size>1)moved=true;
  // Capture on the original canvas so a stationary tap still edits a marker.
  e.target.setPointerCapture(e.pointerId);
 });
 stage.addEventListener('pointermove',e=>{
  if(!points.has(e.pointerId))return;
  const old=points.get(e.pointerId);
  if(Math.hypot(e.clientX-old.startX,e.clientY-old.startY)>5)moved=true;
  points.set(e.pointerId,{...old,x:e.clientX,y:e.clientY});const next=sample();
  if(points.size>1){
   moved=true;
   if(previous.d>0)zoomAt(getZoom()*next.d/previous.d,previous.x,previous.y);
   panBy(next.x-previous.x,next.y-previous.y);
  }else if(canMove())panBy(next.x-previous.x,next.y-previous.y);
  previous=next;
 });
 const end=e=>{
  if(!points.has(e.pointerId))return;
  const touch=e.pointerType!=='mouse';
  if(e.type==='pointerup'&&touch&&!moved&&points.size===1)tap(e);
  points.delete(e.pointerId);if(moved||touch)suppressUntil=performance.now()+400;
  previous=points.size?sample():null;
 };
 for(const event of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(event,end);
 stage.addEventListener('click',e=>{if(performance.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
 stage.addEventListener('wheel',e=>{
  e.preventDefault();zoomAt(getZoom()*Math.exp(-e.deltaY*.002),e.clientX,e.clientY);
 },{passive:false});
 // Safari's gesture events are independent of Pointer Events.
 for(const event of ['gesturestart','gesturechange'])stage.addEventListener(event,e=>e.preventDefault(),{passive:false});
}
