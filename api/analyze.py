"""Image inference API. Photos are not saved; model downloads use static assets."""
from http.server import BaseHTTPRequestHandler
from io import BytesIO
import json
import math
import threading
import time
from PIL import Image, UnidentifiedImageError
from detection_engine import Predictor

Image.MAX_IMAGE_PIXELS = 5_000_000
_predictor = None
_lock = threading.Lock()
MAX_BODY = 4_000_000

class handler(BaseHTTPRequestHandler):
    def reply(self, status, value):
        data = json.dumps(value, ensure_ascii=False, allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.reply(200, {'engine':'server-inference','photoStorage':False,'modelDownload':True})

    def do_POST(self):
        global _predictor
        started = time.perf_counter()
        try:
            length = int(self.headers.get('Content-Length', '0'))
            confidence = float(self.headers.get('X-Confidence', '.5'))
            if not 0 < length <= MAX_BODY:
                return self.reply(413, {'error':'사진 전송 크기는 4MB 이하여야 합니다.'})
            if not math.isfinite(confidence) or not .05 <= confidence <= .95:
                return self.reply(400, {'error':'잘못된 신뢰도 기준입니다.'})
        except (ValueError, TypeError):
            return self.reply(400, {'error':'잘못된 요청입니다.'})
        if self.headers.get('Content-Type','').split(';')[0] not in ['image/png','image/jpeg','image/webp']:
            return self.reply(415, {'error':'PNG, JPG, WebP 사진만 분석할 수 있습니다.'})
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            return self.reply(403, {'error':'앱 화면에서 사진을 선택해 주세요.'})
        if not _lock.acquire(blocking=False):
            return self.reply(429, {'error':'다른 사진을 분석 중입니다. 잠시 후 다시 눌러 주세요.'})
        try:
            payload = self.rfile.read(length)
            if len(payload) != length:
                return self.reply(400, {'error':'사진 전송이 완료되지 않았습니다.'})
            with Image.open(BytesIO(payload)) as image:
                if image.width > 2048 or image.height > 2048:
                    return self.reply(400, {'error':'사진의 긴 변을 2048픽셀 이하로 줄여 주세요.'})
                image.load()
                reused = _predictor is not None
                init_started = time.perf_counter()
                if _predictor is None:
                    _predictor = Predictor(num_threads=2)
                init_ms = round((time.perf_counter()-init_started)*1000)
                result = _predictor.predict(image, confidence=confidence)
            result.update(serverTotalTimeMs=round((time.perf_counter()-started)*1000),
                          sessionInitTimeMs=init_ms,sessionReused=reused,photoStored=False)
            self.reply(200, result)
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
            self.reply(400, {'error':'사진을 읽을 수 없습니다. JPG 또는 PNG로 다시 선택해 주세요.'})
        except Exception as error:
            print('inference_error:',type(error).__name__,flush=True)
            self.reply(500, {'error':'분석 서버에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.'})
        finally:
            _lock.release()
