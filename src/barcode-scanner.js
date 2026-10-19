export function barcodeScanner(dialog,onResult,onError) {
  const video=dialog.querySelector('video');let generation=0,stream=null,controls=null,timer=null;
  const status=dialog.querySelector('[data-scan-status]');
  function stop() {
    generation++;clearTimeout(timer);controls?.stop();controls=null;
    stream?.getTracks().forEach(track=>track.stop());stream=null;video.srcObject=null;
  }
  async function start() {
    stop();dialog.showModal();status.textContent='후면 카메라를 여는 중이에요…';const current=generation;
    try {
      if(!navigator.mediaDevices?.getUserMedia)throw Error('카메라를 사용할 수 없어요. 바코드를 직접 입력해 주세요.');
      const candidate=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
      if(current!==generation||!dialog.open){candidate.getTracks().forEach(track=>track.stop());return;}
      stream=candidate;video.srcObject=stream;await video.play();
      if(current!==generation)return;
      status.textContent='제품 바코드를 화면 가운데에 맞춰 주세요.';
      const found=value=>{if(current!==generation)return;stop();dialog.close();onResult(value);};
      const formats=['ean_13','ean_8','upc_a','upc_e','code_128','data_matrix','qr_code'];
      let native=null;
      if(window.BarcodeDetector) {
        const supported=await BarcodeDetector.getSupportedFormats();
        if(formats.every(format=>supported.includes(format)))native=new BarcodeDetector({formats});
      }
      if(current!==generation)return;
      if(native) {
        const scan=async()=>{
          if(current!==generation)return;
          try {const codes=await native.detect(video);if(current!==generation)return;if(codes.length){found(codes[0].rawValue);return;}}catch{ /* Retry on a partially decoded frame. */ }
          timer=setTimeout(scan,220);
        };void scan();
      }else {
        if(!window.ZXingBrowser)throw Error('바코드 읽기 도구를 불러오지 못했어요. 직접 입력해 주세요.');
        const reader=new window.ZXingBrowser.BrowserMultiFormatReader();
        const candidateControls=await reader.decodeFromVideoElement(video,result=>{if(result)found(result.getText());});
        if(current!==generation)candidateControls.stop();else controls=candidateControls;
      }
    }catch(error) {
      if(current!==generation)return;stop();
      status.textContent=error.name==='NotAllowedError'?'카메라 권한을 허용해 주세요. 창을 닫고 바코드를 직접 입력할 수도 있어요.':error.message||'카메라를 열 수 없어요.';
      onError?.(status.textContent);
    }
  }
  dialog.addEventListener('close',stop);
  dialog.querySelector('[data-scan-close]').onclick=()=>dialog.close();
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&dialog.open){stop();dialog.close();}});
  window.addEventListener('pagehide',stop);
  return {start,stop};
}
