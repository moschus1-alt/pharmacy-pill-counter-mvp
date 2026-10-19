# 유팜데일리: 클라우드 폴링을 PC 직접 연결로 교체

2026-10-19 사용자 요청. 기존 QL-550 GDI 출력 함수는 유지하고 수신 경로만 바꿉니다. 이 작업공간에는 Windows UPharmStats 소스가 없으므로 해당 개발창에서 실제 앱에 적용해야 합니다.

## 적용

1. 기존 `PillCounterReceiver.stop()` 후 기존 스레드 종료를 기다립니다. 기존 클라우드 연결 재생성/자동 수신 시작 코드는 제거합니다. 새 웹 배포의 `/api/print-relay`는 Blob 접근 없이 HTTP 410을 반환합니다. 이전 대기 작업은 자동 이전/재출력하지 않습니다.
2. ZIP의 `direct_server.py`, `admin.html`, `setup.html`, `web/`, `data/`를 앱 리소스에 포함합니다. 기존 Python 환경에 `cryptography==50.0.0`을 포함하거나 ZIP에 든 Windows 런타임을 별도 프로세스로 사용합니다. 독립 출력 프로그램을 실행하면 유팜데일리 소스 수정 없이도 QL-550을 사용할 수 있습니다.
3. `DirectPrinterServer`에 기존 **스풀 결과를 기다리는 출력 콜백**을 넘깁니다. 기존 `PrintRejected`의 `reason`도 호환됩니다. `SPOOLED`는 문자열 `'spooled'`이며 실제 인쇄 완료를 의미하지 않습니다.

```python
from direct_server import DirectPrinterServer

# selected_private_ipv4, selected_printer, existing_print_callback은
# 기존 앱의 실제 네트워크/프린터 선택값과 검증된 GDI 콜백을 연결합니다.
server = DirectPrinterServer(
    existing_print_callback,
    printer_name=selected_printer,
    host=selected_private_ipv4,
    web_root=resources / 'web', catalog_dir=resources / 'data',
    data_dir=private_app_data / 'direct-printer',
    on_event=post_status_to_gui,
)
server.start()
# 로컬 브라우저에서 server.admin_url을 열거나 기존 앱의 로컬 QR 생성기로
# server.mobile_url을 표시하고 최초 인증서 등록용 QR은 server.setup_url로 별도 제공합니다. 외부 QR 서비스를 사용하지 않습니다.
# 설정 화면: server.info(), 인증서 지문: server.fingerprint
# 새 연결: server.rotate(); 이후 새 mobile_url로 QR 재생성
# 실제 출력물/프린터를 사용자 확인한 뒤: server.jobs.resume()
# 앱 종료 시: server.stop()  (진행 중 스풀 콜백이 끝날 때까지 기다림)
```

`on_event`와 출력 콜백은 작업 스레드에서 호출됩니다. GUI 신호/큐를 사용하고 스풀 결과를 기다려야 합니다. 콜백 예약만 한 상태에서 성공을 반환하면 안 됩니다. 포트 8443/8444 및 앱 단일 인스턴스 잠금을 확인하세요. `server.stop()`의 블로킹 대기는 GUI 종료 워커에서 처리합니다.

## 실제 사용자 연결

- 같은 공유기의 PC 사설 IPv4를 선택합니다. Windows 개인 네트워크에서 같은 서브넷의 TCP 8443/8444 인바운드를 허용합니다. 공용 네트워크/라우터 포트 포워딩을 열지 않습니다. 다른 서브넷/VPN 인터페이스를 선택하면 연결되지 않을 수 있습니다.
- PC의 QR은 `http://PC_IP:8444/setup#port=8443` (인증서 설치 전용, 연결 토큰 없음)입니다. 처음 한 번 해당 PC의 CA 인증서를 휴대폰에 등록하고 PC 화면의 SHA-256 지문과 대조합니다. 삼성/Android는 설정의 CA 인증서 설치, iOS는 프로파일 설치 후 인증서 신뢰 설정이 필요합니다. 관리 기기는 설치가 제한될 수 있습니다. 임의 웹사이트 인증서 오류를 무시하는 방식은 사용하지 않습니다.
- 인증서 등록 후 별도의 카운터 연결 QR `https://PC_IP:8443/local.html#direct=...`에서 기존 카운터를 사용합니다. HTTPS가 카메라/암호화 API를 제공합니다. 사진 추론, 모델/엔진 배포, 제품 조회, 라벨 전송이 모두 PC/휴대폰에서 수행됩니다. Vercel 없이 동작합니다.
- PC 주소 변경 시 새 주소로 서버 재시작/QR 재생성이 필요하며 같은 CA를 재사용합니다. 공유기 DHCP 예약을 권장합니다. 연결 토큰은 프로세스 시작/회전 때 바뀌고 8시간 후 만료됩니다. 토큰은 URL fragment 및 sessionStorage에만 두며 로그/쿼리/환자정보에 넣지 않습니다.
- CA 개인키와 출력 저널 디렉터리는 현재 Windows 사용자/SYSTEM만 접근하도록 ACL을 적용합니다. 독립 Start.ps1은 이를 수행합니다. 유팜데일리 내장 시 동일하게 적용하세요. 서버는 파일 경로를 통해 개인키/저널을 제공하지 않습니다.

## 계약 및 중복 방지

- 같은 PC HTTPS origin의 `/api/direct`, Bearer 연결 토큰. GET은 연결 상태, `?action=status&jobId=UUID`는 결과. POST `{action:'submit',jobId,label}`.
- `label`은 기존 전송 필드와 같습니다. 제품명 괄호 성분/밑줄 제거, 수량/날짜/크기 서버 검증. `dk22210` 폭29mm, 길이12~200mm 소수점1자리.
- `/api/direct/events`는 한 개의 스트림으로 PC 상태 변화를 전달합니다. 대기 중 keepalive는 PC 내 TCP 통신이며 저장소 쓰기·클라우드 호출이 없습니다. 제품 조회도 동봉한 심평원 스냅샷을 사용합니다.
- SQLite `synchronous=FULL`에 작업 ID/내용 해시/결과만 저장합니다. 약명·환자정보·토큰은 저널에 저장하지 않습니다. 같은 ID+내용 재요청은 기존 결과, 내용 변경은409입니다.
- 출력 직전 processing 저장 → 기존 출력함수 → spooled 저장. 응답 유실 재전송은 재인쇄하지 않습니다. 비정상 종료의 queued/processing은 failed/uncertain으로 전환하고 정지합니다. 자동 재시도·처리권 해제·저널 삭제를 하지 않습니다. 실제 출력물 확인 후 재개하며 이전 ID는 다시 인쇄하지 않습니다.
- 원본 유팜데일리 메뉴/실행 환경에 실제 반영 및 Windows QL-550 물리 출력 확인은 이 PC에서 해야 합니다. Linux 모의 출력 검증은 이를 대신하지 않습니다.

## 이 저장소에서 완료한 검증

- 직접 서버 7개 테스트: CA/호스트 검증, 인증, 동시 중복 요청, 응답 유실, 비정상 종료, 재개, 토큰 회전/만료, 로컬 제품 조회.
- 기존 휴대폰 UI에서 실제 모델로 8알 인식 → 확인 → 모의 PC 출력까지 통과. 연결 복구/QR 회전/화면 폭 320·390·1280도 확인했습니다. 외부 요청·Blob 요청·서버 분석 요청은 0건입니다.
- PC 전용 다운로드 화면, 이전 클라우드 API 410 및 저장소 요청 0건, ZIP CRC와 동봉 런타임/모델 해시 검증을 통과했습니다.
- 실제 Windows 실행·QL-550 물리 출력 및 UPharmStats 소스 반영은 아직 수행하지 않았습니다. 실제 출력은 사용자의 명시적인 출력 지시가 있을 때 수행하고, 개발 검증에는 모의 출력 함수를 사용하세요.

완료 후 이 문서의 계약에 맞춘 변경 파일, 회귀 테스트 결과, 기존 수신 루프 중지 여부를 사용자에게 보고하세요. 토큰·인증서 개인키·환자정보를 답변/로그에 넣지 마세요.
