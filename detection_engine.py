"""Local inference adapter for the private TFLite artifact."""
from pathlib import Path
import hashlib, time, json
import numpy as np
from PIL import Image, ImageOps, ImageCms
from io import BytesIO
from ai_edge_litert.interpreter import Interpreter

ROOT = Path(__file__).resolve().parent
MODEL = ROOT / 'private-model/counter-model.tflite'
SHA256 = '967308748ace08b219acb3913de40feac92fe71e1864892386b9475923a1275b'
PROFILE = json.loads((ROOT/'private-model/preprocess-profile.json').read_text(encoding='utf-8'))

def android_nearest_resize(pixels, size=832):
    """Skia scale-only, opaque clamp sampling; checked against saved Android tensors.

    X advances in 32.32 fixed point across the scanline. Y is mapped anew
    in float32 for each row. Nearest samples have a 1/65536 source-pixel bias.
    """
    height,width=pixels.shape[:2]
    positions=np.arange(size,dtype=np.int64)
    sx=np.float32(width/size);sy=np.float32(height/size)
    step=int(float(sx)*(1<<32))
    start=int(float(np.float32(sx*np.float32(.5)))*(1<<32))-65536
    xs=(positions*step+start)>>32
    mapped_y=np.float32(np.float32(positions+.5)*sy)
    ys=np.floor(mapped_y.astype(np.float64)-1/65536).astype(np.int64)
    return pixels[np.clip(ys,0,height-1)[:,None],np.clip(xs,0,width-1)[None,:]]

def prepare_input(image):
    image=ImageOps.exif_transpose(image)
    if image.info.get('icc_profile'):
        mode='RGBA' if 'A' in image.getbands() else 'RGB'
        image=ImageCms.profileToProfile(image,ImageCms.ImageCmsProfile(BytesIO(image.info['icc_profile'])),ImageCms.createProfile('sRGB'),outputMode=mode)
    ratio=min(1,2048/max(image.size))
    if ratio<1:image=image.resize(tuple(max(1,int(v*ratio+.5)) for v in image.size),Image.Resampling.BILINEAR)
    w,h=image.size;side=max(w,h);left,top=(side-w)//2,(side-h)//2
    # dl5.e composites non-square images on an opaque black Canvas; a square Bitmap bypasses it.
    if w!=h and ('A' in image.getbands() or 'transparency' in image.info):
        opaque=Image.new('RGBA',image.size,(0,0,0,255));opaque.alpha_composite(image.convert('RGBA'));image=opaque
    square=Image.new('RGB',(side,side),(0,0,0));square.paste(image.convert('RGB'),(left,top))
    tensor=android_nearest_resize(np.asarray(square)).astype(np.float32)[None]/np.float32(255)
    return tensor,w,h

def postprocess(raw, width, height, confidence=.5, iou=.6, roi=None):
    """Reproduce inspected dl5.d/c/a/j semantics, using float32 box arithmetic."""
    raw=np.asarray(raw,dtype=np.float32).copy()
    # dl5.d accepts both xywh and a conditional xyxy layout. Keep its heuristic.
    convert=(raw[:,2]>832)|(raw[:,3]>832)|((raw[:,2]>raw[:,0])&(raw[:,3]>raw[:,1]))
    converted=raw[convert,:4].copy()
    raw[convert,0:2]=(converted[:,0:2]+converted[:,2:4])/np.float32(2)
    raw[convert,2:4]=converted[:,2:4]-converted[:,0:2]
    # Android promotes the float score to double for comparison with the configured double.
    valid=np.isfinite(raw[:,4])&(raw[:,4].astype(np.float64)>=confidence)&(raw[:,2]>np.float32(.001))&(raw[:,3]>np.float32(.001))
    ids=np.flatnonzero(valid)
    ids=ids[np.argsort(-raw[ids,4],kind='stable')]
    boxes=np.column_stack((raw[:,0]-raw[:,2]*np.float32(.5),raw[:,1]-raw[:,3]*np.float32(.5),raw[:,0]+raw[:,2]*np.float32(.5),raw[:,1]+raw[:,3]*np.float32(.5)))
    remaining=ids;keep=[]
    while len(remaining) and len(keep)<1000:
        index=remaining[0];keep.append(index);remaining=remaining[1:]
        intersection=np.maximum(np.float32(0),np.minimum(boxes[index,2:],boxes[remaining,2:])-np.maximum(boxes[index,:2],boxes[remaining,:2])).prod(1)
        # Original computes areas from width*height rather than differences of corners.
        union=raw[index,2]*raw[index,3]+raw[remaining,2]*raw[remaining,3]-intersection
        overlap=np.zeros_like(union);np.divide(intersection,union,out=overlap,where=union>np.float32(1e-6))
        overlap[~np.isfinite(overlap)]=0
        remaining=remaining[overlap.astype(np.float64)<=iou]
    side=max(width,height);left,top=(side-width)//2,(side-height)//2
    factor=np.float32(side)/np.float32(832)
    objects=[]
    for index in keep:
        cx,cy,bw,bh=raw[index,:4]*factor
        x1=max(np.float32(0),(cx-bw/np.float32(2))*np.float32(832)-np.float32(left))
        y1=max(np.float32(0),(cy-bh/np.float32(2))*np.float32(832)-np.float32(top))
        x2=min(np.float32(width),(cx+bw/np.float32(2))*np.float32(832)-np.float32(left))
        y2=min(np.float32(height),(cy+bh/np.float32(2))*np.float32(832)-np.float32(top))
        if not np.isfinite([x1,y1,x2,y2]).all() or x2<=x1 or y2<=y1:continue
        centerx=np.clip(cx*np.float32(832)-np.float32(left),np.float32(0),np.float32(width))
        centery=np.clip(cy*np.float32(832)-np.float32(top),np.float32(0),np.float32(height))
        # dl5.j returns independently clipped normalized center and clipped box size.
        nx,ny=centerx/np.float32(width),centery/np.float32(height)
        nw,nh=(x2-x1)/np.float32(width),(y2-y1)/np.float32(height)
        if roi is not None and not(nx-nw/2>=roi[0] and ny-nh/2>=roi[1] and nx+nw/2<=roi[2] and ny+nh/2<=roi[3]):continue
        x1,y1,x2,y2=map(float,[x1,y1,x2,y2]);area=(x2-x1)*(y2-y1);score=float(raw[index,4])
        objects.append(dict(id=f'pill-{index}',queryIndex=int(index),x=float(nx)*width,y=float(ny)*height,r=(area/np.pi)**.5,area=area,bbox=[x1,y1,x2-x1,y2-y1],contour=[[x1,y1],[x2,y1],[x2,y2],[x1,y2]],source='auto',confidence=score,label=0,needsReview=score<.65))
    return objects

class Predictor:
    def __init__(self, num_threads=1):
        self.num_threads = num_threads
        if hashlib.sha256(MODEL.read_bytes()).hexdigest() != SHA256:
            raise ValueError('Model hash mismatch')
        self.engine = Interpreter(model_path=str(MODEL), num_threads=num_threads)
        self.engine.allocate_tensors()
        self.input = self.engine.get_input_details()[0]
        self.output = self.engine.get_output_details()[0]
        assert list(self.input['shape']) == [1,832,832,3]
        assert list(self.output['shape']) == [1,5,14196]

    def predict(self, image, confidence=.5, iou=.6, roi=None, raw_path=None):
        started = time.perf_counter()
        tensor,w,h=prepare_input(image)
        self.engine.set_tensor(self.input['index'],tensor)
        self.engine.invoke()
        raw = self.engine.get_tensor(self.output['index'])[0].T
        if raw_path is not None:np.savez_compressed(raw_path,raw=raw,width=w,height=h)
        objects=postprocess(raw,w,h,confidence,iou,roi)
        return dict(objects=objects,processingTimeMs=round((time.perf_counter()-started)*1000),quality=None,
            warnings=['자동 분석 결과입니다. 번호와 실제 알약을 대조하세요.'],
            detector=dict(type='server-inference',model='Private TFLite model',sha256=SHA256,runtime=f'ai-edge-litert 2.1.3 CPU ({self.num_threads} threads)',license='Redistribution permission unverified',profile=PROFILE['profile'],parameters=dict(confidence=confidence,iou=iou,roi=roi,inputSize=832,threads=self.num_threads,preprocess='center black square, Skia scanline nearest sampling, RGB/255 NHWC',postprocess='original dl5 decode heuristic, stable NMS epsilon 1e-6, independent center clipping')))
