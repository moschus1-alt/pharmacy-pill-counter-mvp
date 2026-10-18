// One square field of view for preview, live inference, capture and export.
export const CAMERA_ASPECT_RATIO = 1;
export function cameraConstraints(){
 return {audio:false,video:{facingMode:{ideal:'environment'},aspectRatio:{ideal:CAMERA_ASPECT_RATIO},width:{ideal:1920},height:{ideal:1920},frameRate:{ideal:15,max:30}}};
}
export function captureCameraFrame(target,video,maxSide=2048){
 const width=video.videoWidth||video.width,height=video.videoHeight||video.height;
 if(!width||!height)throw Error('카메라 화면이 준비되지 않았습니다. 잠시 후 다시 눌러 주세요.');
 const side=Math.min(width,height),size=Math.max(1,Math.min(maxSide,Math.floor(side)));
 target.width=size;target.height=size;
 // Matches CSS object-fit: cover with centered object-position, without stretching.
 target.getContext('2d').drawImage(video,(width-side)/2,(height-side)/2,side,side,0,0,size,size);
}
