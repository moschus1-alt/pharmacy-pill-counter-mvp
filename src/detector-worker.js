/* global cv */
let ready;
function loadCV(){return ready ||= new Promise((resolve,reject)=>{
  self.Module={onRuntimeInitialized:()=>resolve({cv:self.cv}),onAbort:reject};
  try{importScripts('../vendor/opencv.js');if(self.cv?.then)self.cv.then(module=>resolve({cv:module}),reject);else if(self.cv?.Mat)resolve({cv:self.cv});}catch(error){reject(error);}
});}

// One marker per smoothed distance ridge, with non-maximum suppression along capsules.
function splitGroup(cv,contour,rect,solidity,binary,keep){
  // Scored tablets have an internal dark groove but a convex outer silhouette.
  // Do not treat that groove as the gap between two pills.
  if(solidity>.985&&Math.max(rect.width/rect.height,rect.height/rect.width)<3.5)return null;
  const local=[];const use=m=>(local.push(m),m);
  try{
    const mask=use(cv.Mat.zeros(rect.height+4,rect.width+4,cv.CV_8UC1));
    const vector=use(new cv.MatVector());vector.push_back(contour);
    cv.drawContours(mask,vector,0,new cv.Scalar(255),-1,cv.LINE_8,use(new cv.Mat()),0,new cv.Point(2-rect.x,2-rect.y));
    // Preserve internal seams and holes; filling the outer contour merges separate tablets.
    for(let y=0;y<rect.height;y++)for(let x=0;x<rect.width;x++)mask.data[(y+2)*mask.cols+x+2]&=binary.data[(y+rect.y)*binary.cols+x+rect.x];
    const distance=use(new cv.Mat()),smooth=use(new cv.Mat()),dilated=use(new cv.Mat()),peaks=use(new cv.Mat());
    cv.distanceTransform(mask,distance,cv.DIST_L2,5);cv.GaussianBlur(distance,smooth,new cv.Size(5,5),1);
    const max=cv.minMaxLoc(smooth).maxVal;if(max<2)return null;
    const k=use(cv.getStructuringElement(cv.MORPH_ELLIPSE,new cv.Size(5,5)));
    cv.dilate(smooth,dilated,k);cv.compare(smooth,dilated,peaks,cv.CMP_GE);
    for(let i=0;i<peaks.data.length;i++)if(smooth.data32F[i]<Math.max(1.5,max*.38))peaks.data[i]=0;
    const pc=use(new cv.MatVector()),hier=use(new cv.Mat());cv.findContours(peaks,pc,hier,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
    const seeds=[];
    for(let i=0;i<pc.size();i++){const p=pc.get(i);try{const b=cv.boundingRect(p);const x=b.x+(b.width-1)/2,y=b.y+(b.height-1)/2;seeds.push({x,y,r:smooth.data32F[Math.round(y)*mask.cols+Math.round(x)]});}finally{p.delete();}}
    seeds.sort((a,b)=>b.r-a.r);const selected=[];
    for(const s of seeds)if(!selected.some(p=>{
      const d=Math.hypot(s.x-p.x,s.y-p.y),radius=Math.max(s.r,p.r);
      if(d<Math.min(s.r,p.r)*1.1)return true;
      if(d>radius*4)return false;
      let saddle=Infinity;
      for(let t=1;t<Math.ceil(d);t++){const x=Math.round(p.x+(s.x-p.x)*t/d),y=Math.round(p.y+(s.y-p.y)*t/d);saddle=Math.min(saddle,smooth.data32F[y*mask.cols+x]);}
      // Two centers separated by a deep neck belong to different pills; a flat ridge
      // within one long capsule contributes only one center.
      return saddle>=Math.min(s.r,p.r)*.85;
    }))selected.push(s);
    if(selected.length<2||selected.length>80)return null;
    const labels=new Int16Array(mask.rows*mask.cols);labels.fill(-1);
    for(let y=0;y<mask.rows;y++)for(let x=0;x<mask.cols;x++)if(mask.data[y*mask.cols+x]){
      let best=-1,d=Infinity;selected.forEach((s,j)=>{const v=(x-s.x)**2+(y-s.y)**2;if(v<d){best=j;d=v;}});labels[y*mask.cols+x]=best;
    }
    const output=[];
    for(let j=0;j<selected.length;j++){
      const part=use(cv.Mat.zeros(mask.rows,mask.cols,cv.CV_8UC1));for(let i=0;i<labels.length;i++)if(labels[i]===j)part.data[i]=255;
      const contours=use(new cv.MatVector());cv.findContours(part,contours,hier,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
      let biggest=null,area=0;
      for(let i=0;i<contours.size();i++){const c=contours.get(i),a=cv.contourArea(c);if(a>area){biggest?.delete();biggest=c;area=a;}else c.delete();}
      if(biggest){for(let i=0;i<biggest.data32S.length;i+=2){biggest.data32S[i]+=rect.x-2;biggest.data32S[i+1]+=rect.y-2;}output.push(keep(biggest));}
    }
    return output;
  }finally{local.reverse().forEach(m=>m.delete());}
}

self.onmessage=async({data:{imageData,parameters={}}})=>{
  const mats=[],keep=m=>(mats.push(m),m);
  try{
    const {cv}=await loadCV(),start=performance.now(),{width:w,height:h,data:pixels}=imageData;
    const sensitivity=Math.max(.5,Math.min(1.5,Number(parameters.sensitivity)||.8)),suppressReflections=parameters.suppressReflections!==false;
    const src=keep(cv.matFromImageData(imageData)),rgb=keep(new cv.Mat()),background=keep(new cv.Mat());cv.cvtColor(src,rgb,cv.COLOR_RGBA2RGB);
    const backgroundSigma=Math.max(8,Math.min(w,h)*.045);
    cv.GaussianBlur(rgb,background,new cv.Size(0,0),backgroundSigma,backgroundSigma,cv.BORDER_REFLECT);
    const positive=keep(new cv.Mat(h,w,cv.CV_8UC1)),negative=keep(new cv.Mat(h,w,cv.CV_8UC1));let brightness=0;
    const noise=[];
    for(let i=0;i<w*h;i++){
      const r=pixels[i*4]-background.data[i*3],g=pixels[i*4+1]-background.data[i*3+1],b=pixels[i*4+2]-background.data[i*3+2];
      const delta=Math.hypot(r,g,b)/Math.sqrt(3),sign=r+g+b;
      positive.data[i]=sign>=0?delta:0;negative.data[i]=sign<0?delta:0;
      brightness+=(pixels[i*4]+pixels[i*4+1]+pixels[i*4+2])/3;if(i%13===0)noise.push(delta);
    }
    noise.sort((a,b)=>a-b);const noiseMedian=noise[Math.floor(noise.length*.5)]||0;
    const deviations=noise.map(v=>Math.abs(v-noiseMedian)).sort((a,b)=>a-b),mad=deviations[Math.floor(deviations.length*.5)]||0;
    const noiseFloor=Math.max(10,noiseMedian+3*mad);
    const objects=[],thresholds=[];let edgeCount=0,rejectedReflections=0,splitCount=0;
    const minArea=Math.max(20,w*h*.00004);
    for(const [polarity,difference]of [['light',positive],['dark',negative]]){
      const smooth=keep(new cv.Mat()),mask=keep(new cv.Mat());cv.GaussianBlur(difference,smooth,new cv.Size(3,3),.65);
      const otsu=cv.threshold(smooth,mask,0,255,cv.THRESH_BINARY|cv.THRESH_OTSU);
      const threshold=Math.max(noiseFloor,Math.min(otsu*.72,45))/sensitivity;thresholds.push(threshold);
      cv.threshold(smooth,mask,threshold,255,cv.THRESH_BINARY);
      // Closing used to bridge small gaps between tablets; preserve those gaps now.
      const contours=keep(new cv.MatVector()),hierarchy=keep(new cv.Mat());cv.findContours(mask,contours,hierarchy,cv.RETR_EXTERNAL,cv.CHAIN_APPROX_SIMPLE);
      const dx=keep(new cv.Mat()),dy=keep(new cv.Mat());cv.Sobel(smooth,dx,cv.CV_32F,1,0,3);cv.Sobel(smooth,dy,cv.CV_32F,0,1,3);
      for(let i=0;i<contours.size();i++){
        const contour=keep(contours.get(i)),rect=cv.boundingRect(contour),area=cv.contourArea(contour);
        if(area<minArea||area>w*h*.15)continue;
        if(rect.x<2||rect.y<2||rect.x+rect.width>=w-2||rect.y+rect.height>=h-2){edgeCount++;continue;}
        const hull=keep(new cv.Mat());cv.convexHull(contour,hull);const solidity=area/Math.max(1,cv.contourArea(hull));
        const parts=splitGroup(cv,contour,rect,solidity,mask,keep);if(parts)splitCount+=parts.length-1;
        for(const part of parts||[contour]){
          const a=cv.contourArea(part),b=cv.boundingRect(part),perimeter=cv.arcLength(part,true),circularity=4*Math.PI*a/(perimeter*perimeter);
          if(a<minArea||circularity<.18||a/(b.width*b.height)<.3)continue;
          const moments=cv.moments(part),x=moments.m10/moments.m00,y=moments.m01/moments.m00;
          let edgeSum=0,edgeSamples=0;const p=part.data32S;
          for(let j=0;j<p.length;j+=2){const k=(j+2)%p.length,steps=Math.max(1,Math.ceil(Math.hypot(p[k]-p[j],p[k+1]-p[j+1])));
            for(let t=0;t<steps;t++){const xx=Math.round(p[j]+(p[k]-p[j])*t/steps),yy=Math.round(p[j+1]+(p[k+1]-p[j+1])*t/steps),index=yy*w+xx;edgeSum+=Math.hypot(dx.data32F[index],dy.data32F[index])/8;edgeSamples++;}}
          const edgeSharpness=edgeSum/Math.max(1,edgeSamples),aspect=Math.max(b.width/b.height,b.height/b.width);
          if(suppressReflections&&(aspect>5||(!parts&&circularity<.3)||edgeSharpness<2.2/sensitivity)){rejectedReflections++;continue;}
          const points=[];for(let j=0;j<p.length;j+=2)points.push([p[j],p[j+1]]);
          objects.push({id:`${polarity}-${i}-${objects.length}`,x,y,r:Math.sqrt(a/Math.PI),area:a,contour:points,source:'auto',split:!!parts,polarity,edgeSharpness});
        }
      }
    }
    objects.sort((a,b)=>b.area*b.edgeSharpness-a.area*a.edgeSharpness);
    const kept=[];for(const o of objects)if(!kept.some(p=>p.polarity!==o.polarity&&Math.hypot(p.x-o.x,p.y-o.y)<Math.max(p.r,o.r)*1.1))kept.push(o);
    kept.sort((a,b)=>a.y-b.y||a.x-b.x);
    const sortedAreas=kept.map(o=>o.area).sort((a,b)=>a-b),medianArea=sortedAreas[Math.floor(sortedAreas.length/2)]||0;
    for(const o of kept)o.needsReview=o.split||o.area>medianArea*1.7;
    const warnings=[];
    if(!kept.length)warnings.push('검출된 알약이 없습니다. 자동 인식 조정에서 민감도를 높이거나 누락 추가로 직접 표시하세요.');
    if(splitCount)warnings.push('붙은 윤곽을 분리해 추정했습니다. 번호가 실제 알약 하나씩에 붙었는지 확인하세요.');
    if(kept.some(o=>o.needsReview))warnings.push('주황색 윤곽은 분리 추정 또는 크기가 큰 후보입니다. 둘 이상이 하나로 잡히지 않았는지 검수하세요.');
    if(edgeCount)warnings.push('화면 가장자리 물체는 제외했습니다. 전체 알약이 보이도록 촬영하세요.');
    if(rejectedReflections)warnings.push('흐린 반사 후보를 제외했습니다. 옅은 알약이 누락되지 않았는지 확인하세요.');
    self.postMessage({objects:kept,processingTimeMs:Math.round(performance.now()-start),detector:{type:'opencv',version:'4.9.0',pipelineVersion:'1.2.0',parameters:{sensitivity,suppressReflections,thresholds,backgroundSigma,minArea}},quality:{brightness:Math.round(brightness/(w*h)),noiseMedian,mad,rejectedReflections,splitCount},warnings});
  }catch(error){self.postMessage({error:'자동 분석에 실패했습니다. '+(error.message||String(error))});}
  finally{mats.reverse().forEach(m=>m.delete());}
};

