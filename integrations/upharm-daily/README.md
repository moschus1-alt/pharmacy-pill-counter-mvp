> **2026-10-19 전환:** 아래 클라우드 릴레이 계약은 종료됐습니다. 새 [PC 직접 연결 계약](../direct-printer/CODEX_HANDOFF.md)을 적용하세요. 기존 API는 Blob 접근 없이 410을 반환합니다.

# 유팜데일리 ↔ 알약카운터 연동

Python 유팜데일리의 **이미 작동하는 QL-550 출력 함수**에 연결하는 수신 모듈입니다. Python 표준 라이브러리만 사용합니다. 이 패키지만 다운로드해서는 유팜데일리 내부 메뉴/출력 함수 연결이 완료되지 않습니다. 실제 프로젝트를 연 Codex가 `CODEX_HANDOFF.md`를 읽고 적용해야 합니다.

## 사용자 흐름

1. 적용 완료된 유팜데일리에서 ‘알약카운터 연결’을 생성하고 QL-550 수신을 시작합니다. 연결 정보는 PC에서 보호 저장합니다.
2. 유팜데일리에 표시한 로컬 QR을 휴대폰으로 읽습니다. 이후 휴대폰에서 라벨을 전송하면 유팜데일리가 기존 함수로 바로 출력합니다. PC 웹앱이나 JSON 파일 다운로드가 필수는 아닙니다.
3. 연결은 생성부터 8시간 후 만료됩니다. 유팜데일리에서 재생성한 뒤 휴대폰에서 새 QR을 읽습니다. 기존 대기 작업은 자동 이전되지 않습니다. 종료/PC 절전 중에는 자동 출력되지 않습니다.
4. 기존 웹앱의 ‘이 PC에서 라벨 받기 → 유팜데일리 연결 파일 받기’는 호환용으로 유지할 수 있습니다. 인증 파일은 다른 사람에게 보내거나 Git에 올리지 않습니다.

직접 생성의 응답 타입, epoch 밀리초, 키 역할, QR, 재생성 및 claim/spooled 세부 계약은 `CODEX_HANDOFF.md`의 ‘직접 생성 계약’ 절을 따릅니다. 기존 `PillCounterReceiver`는 연결 생성 UI를 포함하지 않으며 생성 응답을 config로 매핑해 넘기면 됩니다.

## 기존 출력 함수에 붙이는 인터페이스

```python
import json
from pill_counter_relay import PillCounterReceiver, PrintRejected, SPOOLED

# 기존 유팜데일리의 인쇄 함수와 실제 반환값에 맞춰 아래 콜백을 구현합니다.
# existing_print_label은 인터페이스 설명용 이름이며 이 패키지의 함수가 아닙니다.
def print_received_label(label):
    # 필드 매핑 / 인쇄 가능 영역 검사 / 선택된 QL-550으로 무대화상자 인쇄.
    # existing_print_label(...)
    # 드라이버에 정상 접수된 것을 확인한 경우에만 return SPOOLED.
    # 인쇄하지 못한 것이 확실하면 raise PrintRejected('printer' 또는 'layout').
    # 접수 여부가 불확실하면 raise PrintRejected('uncertain').
    raise NotImplementedError('유팜데일리의 실제 출력 함수에 연결해야 합니다')

# connection_path, app_data_dir, selected_printer_name은 기존 앱 설정에서 가져옵니다.
# config = json.loads(connection_path.read_text(encoding='utf-8'))
# receiver = PillCounterReceiver(config, print_received_label,
#     printer_name=selected_printer_name, journal_dir=app_data_dir,
#     on_event=forward_event_to_gui)
# receiver.start()
# 앱 종료 시 receiver.stop(). 오류 확인 후 receiver.resume().
```

`print_label`은 수신 작업 스레드에서 실행됩니다. Qt/Tk GUI 스레드가 필요한 기존 함수라면 앱의 신호/큐로 넘기고 **실제 스풀 접수 결과를 기다린 후** 콜백을 완료해야 합니다. GUI 이벤트를 예약한 것만으로 `SPOOLED`를 반환하면 안 됩니다. `on_event`도 작업 스레드에서 발생하므로 GUI 스레드로 전달합니다. 앱 전체에서 수신 인스턴스 하나만 유지하고, 기존 인스턴스 종료를 확인한 뒤 연결 파일을 교체합니다.

## 라벨 필드

| 필드 | 의미 |
|---|---|
| `code`, `name`, `strength`, `manufacturer` | 제품 바코드, 제품명, 함량·규격, 제조사 |
| `count` | 사용자가 확인한 실제 소분 수량 (정수) |
| `lot`, `packedOn`, `expiry`, `useBy` | 제조번호, 소분일, 제품 사용기한, 소분 후 사용기한; 없는 항목은 빈 문자열 |
| `copies` | 동일 라벨 출력 매수 (1~20) |
| `size` | `dk22210`, `custom`, 또는 `60x40` 등 고정 규격 |
| `widthMm`, `heightMm` | 연속/직접 입력 용지의 폭·한 장 길이(mm) |

현재 사용 용지는 **DK-22210, 폭 29 mm 연속 용지**입니다. `dk22210`의 `widthMm=29`, 기본 `heightMm=90`; 길이는 사용자가 바꿀 수 있습니다. 고정 규격은 `60x40`, `70x50`, `50x30`, `62x29`, `62x100`, `29x90`입니다. QL-550에서 지원하지 않는 용지 폭/규격은 조용히 바꾸지 말고 `PrintRejected('layout')`로 막으세요. 드라이버가 요청한 길이를 적용하는지 확인해야 합니다. 필수 정보가 잘리면 인쇄 전에 거부하고 길이를 늘리도록 안내합니다. 기존 템플릿의 의료 정보 의미를 바꾸거나 제조번호/사용기한/수량을 생략하지 않습니다.

## 상태·중복 출력 방지

- 서버에 생성 전용 처리권을 확보한 수신기만 출력합니다. 처리권은 시간 경과로 자동 해제하지 않습니다.
- 스풀 전후 진행 상황은 사용자 앱 데이터 폴더의 JSON 저널에 원자적으로 저장합니다. 저널에는 인증키/제품명이 없고 요청 ID와 결과만 있습니다.
- 프린터 접수 후 서버 응답이 끊기면 **결과 통보만 재시도**합니다. 인쇄 함수는 다시 호출하지 않습니다.
- 인쇄 전후 프로세스가 종료되어 접수 여부가 불확실하면 실패로 보고하고 새 인쇄를 일시정지합니다. 실제 출력물 확인 후 재개합니다. 저널 삭제나 처리권 초기화로 자동 재출력하지 않습니다.
- `spooled`는 ‘프린터로 전송’이며 물리 출력 완료 보증이 아닙니다. 용지 없음/걸림은 Windows 드라이버와 실제 출력물에서 확인합니다.
- `ready` 상태는 유팜데일리 수신기 상태입니다. 물리 프린터 온라인 상태는 기존 유팜데일리 프린터 검사와 연결해야 합니다.

## API

HTTPS `/api/print-relay`, `Authorization: Bearer <ownerToken>`. POST JSON 공통 필드는 `action`, `station`. GET은 같은 필드를 쿼리로 전달합니다. 인증키는 URL에 넣지 않습니다.

- POST `receiver-heartbeat`: `receiverId`(UUID), `printerName`, `state`(`ready`/`error`/`stopped`). 모듈은 15초 간격, 화면에서는 60초 이상 갱신이 없으면 끊김 표시.
- GET `jobs`: `waiting`/`processing` 상태와 라벨 목록.
- POST `claim`: `jobId`, `receiverId`, `claimId`(새 UUID). `claimed:true`를 명확히 수신한 경우만 출력. 같은 요청 재호출도 `claimed:false`가 될 수 있으므로 출력 권한 재사용 금지.
- POST `spooled` 또는 `failed`: 동일 `jobId`, `receiverId`, `claimId`. `failed`는 `reason`(`printer`/`layout`/`uncertain`). 동일 결과 재통보는 멱등.
- GET `connection`: 연결 정보/수신기 상태. 휴대폰 키로는 처리권 확보/수신기 상태 변경/스풀 통보 불가.
- 403/410: 키 무효 또는 8시간 만료. 새 연결이 필요하며 수신을 종료.

이 패키지는 API·중복 요청·응답 유실·수신기 재시작·오류 일시정지를 검증했습니다. 실제 UPharmStats 코드에 적용 및 Windows QL-550 물리 출력은 해당 PC에서 검증해야 합니다.
