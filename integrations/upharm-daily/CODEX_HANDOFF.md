> **2026-10-19 전환:** 아래 클라우드 릴레이 계약은 종료됐습니다. 새 [PC 직접 연결 계약](../direct-printer/CODEX_HANDOFF.md)을 적용하세요. 기존 API는 Blob 접근 없이 410을 반환합니다.

# PC의 Codex에 전달할 작업

현재 열린 Python 프로젝트 **UPharmStats (유팜데일리)** 에 알약카운터 라벨 자동 출력 연동을 구현해 주세요. 이 문서는 사용자 요청을 옮긴 구현 지침입니다.

사용자는 QL-550으로 유팜데일리에서 이미 라벨을 출력하고 있습니다. 사용 용지는 DK-22210, 폭 29mm 연속입니다. 휴대폰에서 바코드 → 카운팅 → 라벨 확인 → 전송하면 PC에서 다시 클릭하지 않고 유팜데일리의 기존 프린터로 출력되어야 합니다.

준비된 서버: https://pharmacy-pill-counter-mvp.vercel.app
연동 파일: 이 문서와 같은 폴더의 `pill_counter_relay.py`, `README.md`.
원본 패키지: https://pharmacy-pill-counter-mvp.vercel.app/integrations/upharm-daily.zip

1. 프로젝트 지침과 구조를 읽고 현재 QL-550 인쇄 함수, 라벨 템플릿, 프린터 설정, GUI 프레임워크, 앱 데이터 저장 위치를 찾으세요. 함수 이름이나 인자를 추측해서 미연결 예제만 남기지 마세요. 실제 기존 출력 코드에 연결해야 합니다.
2. `pill_counter_relay.py`를 적절한 모듈 위치에 넣고 기존 패키징 설정에도 포함하세요. 신규 드라이버나 별도 출력 엔진 대신 기존 QL-550 출력 경로를 사용하세요.
3. 설정에 ‘알약카운터 연결’을 추가하세요. 기본 흐름은 아래 계약에 따라 유팜데일리가 직접 연결을 생성하고 로컬 QR을 보여주는 방식입니다. JSON 가져오기는 기존 연결 호환용으로 유지할 수 있지만 파일을 찾아달라고 사용자에게 요구하지 마세요. 현재 프린터 선택/수신 시작·중지/연결 상태/8시간 만료·재생성/오류 확인 후 재개를 제공하세요. 키와 연결 정보는 사용자 앱 데이터에 DPAPI로 보호하고 로그/Git/공개 배포에 넣지 마세요. 사용자에게 토큰이나 API 주소를 직접 편집하게 하지 마세요.
4. 기존 출력 함수로 `print_label(label)` 어댑터를 구현하세요. 이름/함량/수량/제조번호/소분일/제품 사용기한/소분 후 사용기한/바코드/출력 매수를 정확히 매핑하세요. DK-22210 폭29mm와 요청 길이를 드라이버에 적용하고 필수 정보가 잘리면 인쇄 전에 거부하세요. 다른 용지도 실제 드라이버 지원 여부를 검증하세요.
5. 인쇄 확인창 없이 선택된 QL-550에 스풀한 것을 확인한 경우에만 `SPOOLED`를 반환하세요. GUI 작업 예약만으로 성공 처리하지 마세요. 프린터 접수 여부가 불확실하면 `PrintRejected('uncertain')`로 처리하고 자동 재출력하지 마세요. GUI 스레드 전환이 필요하면 실제 결과를 기다리는 안전한 어댑터를 구현하세요.
6. 앱 인스턴스당 수신기 하나를 실행하고 UI를 멈추지 않게 처리하세요. 종료 시 신규 수신 중단, 재연결 시 기존 수신기 종료 확인, 오류 후 명시적 재개를 구현하세요. 기존 저널과 서버 처리권으로 중복 출력을 방지하는 동작을 보존하세요.
7. 기존 기능 회귀, 직접 연결 생성/만료/재생성, 필드 매핑, 중복 요청, 통신 재연결, 29mm/가변 길이, 오류 상태를 검증하세요. 현재 조율 단계에서는 테스트용 출력 함수만 사용하고 실제 출력·조제는 하지 마세요. 물리 출력은 후속 실기기 검증으로 남기고 완료했다고 보고하지 마세요.

서버 측 API/휴대폰 상태 화면/수신 Python 모듈은 준비되어 있습니다. 남은 작업은 **이 PC의 실제 유팜데일리 코드에 메뉴와 출력 어댑터를 적용**하는 것입니다. 일반적인 설명이나 구현 예시로 끝내지 말고 실제 프로젝트를 수정하고 검증해 주세요.


## 직접 생성 계약 — 2026-10-19 확인

현재 배포된 API의 계약이며 기존 claim/spooled 계약과 Python 수신 모듈 인터페이스는 변경하지 않습니다. API에 별도 버전 응답 필드는 없습니다. 로컬 설정의 `schemaVersion: 1`은 연결 파일 형식 버전입니다.

### 연결 생성과 응답 타입

```http
POST https://pharmacy-pill-counter-mvp.vercel.app/api/print-relay
Content-Type: application/json

{"action":"create","name":"유팜데일리 QL-550"}
```

`create`에는 기존 Authorization이나 station이 필요하지 않습니다. 성공은 HTTP 200이며 응답 본문은 래퍼 없는 JSON 객체입니다.

| 필드 | JSON 타입 | 계약 |
|---|---|---|
| `id` | string | `^[0-9]{13}-[a-f0-9]{32}$` 형태의 불투명 연결 ID |
| `name` | string | 서버가 앞뒤 공백을 제거한 이름, 최대 40자 |
| `ownerToken` | string | `^[a-f0-9]{64}$`, PC 수신/출력 결과 통보용 |
| `pairToken` | string | `^[a-f0-9]{64}$`, 휴대폰 연결/전송용; ownerToken과 별개 |
| `expiresAt` | number | **UTC Unix epoch 밀리초 정수**; ISO 문자열·초·남은 기간이 아님 |

만료는 생성 시점부터 28,800,000ms(8시간)이며 heartbeat/pair/jobs로 연장되지 않습니다. Python 시간 비교는 `time.time() * 1000`, 날짜 변환은 `datetime.fromtimestamp(expiresAt / 1000, timezone.utc)` 후 사용자 시간대로 변환합니다. PC 시계와 서버 시계가 다를 수 있으므로 서버의 403/410 처리도 유지합니다.

생성 응답을 다음과 같이 수신 모듈 설정으로 매핑합니다. `pairToken`은 QR 재표시를 위해 별도로 함께 보호 저장해도 됩니다. 기존 수신 모듈에는 pairToken이 필수가 아닙니다.

```python
config = {
    "schemaVersion": 1,
    "apiUrl": "https://pharmacy-pill-counter-mvp.vercel.app/api/print-relay",
    "stationId": response["id"],
    "ownerToken": response["ownerToken"],
    "expiresAt": response["expiresAt"],
}
pair_url = (
    "https://pharmacy-pill-counter-mvp.vercel.app/#pc="
    + response["id"] + "." + response["pairToken"]
)
```

QR은 `pair_url` 전체를 PC에서 로컬 생성합니다. 원문 `#pc=id.pairToken` 형식과 URLSearchParams로 인코딩한 형식 모두 웹앱에서 지원됩니다. 토큰을 쿼리나 로그에 넣거나 외부 QR 생성 서비스에 보내지 마세요. ownerToken은 QR에 넣지 않습니다. 웹앱은 이 링크에서 모바일 페어링을 자동 처리합니다. JSON 다운로드나 PC 웹앱의 선행 실행은 필요 없습니다.

### 만료·재생성·재시도

- 만료된 연결 또는 종료/삭제된 연결 요청은 410. 살아 있는 연결의 잘못된 토큰은 403. 성공 응답의 expiresAt만 믿고 반복 재시도하지 않습니다.
- `create`는 멱등 요청이 아닙니다. 네트워크 응답 유실 후 재호출하면 다른 연결이 생깁니다. 새로 받은 연결 하나만 활성화하고 중복 수신기를 띄우지 마세요. 새 ID에 이전 작업 저널을 덮어 씌우지 않습니다.
- 새 연결에는 새 id/ownerToken/pairToken/expiresAt이 생깁니다. 휴대폰은 새 QR을 다시 읽어야 하며 기존 페어링/대기 작업이 자동 이전되지 않습니다.
- 재생성은 기존 수신기를 중지하고 진행 중 인쇄 결과가 정리된 뒤 수행합니다. 살아 있는 이전 연결을 종료할 경우 기존 ownerToken으로 `POST {"action":"close","station":old_id}`. 이 동작은 이전 대기 작업을 삭제하므로 대기/처리 중 작업을 확인한 뒤 명시적인 재연결 흐름에서 수행하세요. 실제 인쇄에 이미 전달된 작업을 취소하는 API는 아닙니다.
- 중간 오류(503/네트워크)는 연결 오류로 표시하고 backoff할 수 있지만, 성공 여부가 불확실한 인쇄를 재호출하지 않습니다.

### 기존 수신·처리 계약: 변경 없음

모든 생성 이후 API 요청은 `station` 필드를 사용합니다. 로컬 설정명 `stationId`를 요청 본문에 그대로 보내면 안 됩니다. PC는 `Authorization: Bearer <ownerToken>`, 휴대폰은 `<pairToken>`을 사용합니다.

| 액션 | 메서드 | 입력/결과 |
|---|---|---|
| `receiver-heartbeat` | POST | `receiverId` UUID, `printerName`, `state` = ready/error/stopped. 권장 15초 주기 |
| `connection` | GET | `name`, `expiresAt`, `receiver`(미접속이면 null). receiver: app, printerName, state, updatedAt, online |
| `jobs` | GET | `jobs` 배열, name/expiresAt/receiver. 작업: id, label, createdAt, status(waiting/processing), 처리 중이면 claimedAt |
| `claim` | POST | jobId, receiverId, claimId(각 UUID). 새 처리권 확보에만 `{"claimed":true}`; 이미 존재/처리된 요청은 HTTP 200 `{"claimed":false}` |
| `spooled` | POST | jobId, receiverId, claimId. 해당 처리권 소유자만 결과 통보. 결과: status, at |
| `failed` | POST | 위 필드와 reason(printer/layout/uncertain). 결과: status, at, reason |
| `status` | GET | jobId. waiting/processing/spooled/failed/printed/dismissed 중 상태. at은 있는 경우 epoch ms |

`receiverId`, `claimId`, `jobId`에는 하이픈이 포함된 **소문자 UUID 문자열**을 사용합니다. `updatedAt`, `createdAt`, `claimedAt`, `at`도 epoch 밀리초입니다. `online`은 60초 내 heartbeat 여부이며 state가 stopped/error여도 true일 수 있습니다. ‘자동 출력 준비됨’은 **online && state == ready**로 판단합니다. 물리 프린터 온라인 보증은 아닙니다.

처리권에는 자동 만료/반납/재할당 기능이 없습니다. 같은 claimId 재요청도 claimed:false이므로 true 응답을 받지 못했다면 인쇄하지 않습니다. 통신 유실 후 claimed:false는 이전 인쇄의 성공을 의미하지 않습니다. spooled/failed는 같은 처리권과 **같은 결과**로 재통보할 때 멱등이며, 다른 결과나 다른 처리권은 409입니다. spooled는 스풀 접수이고 실제 출력 완료가 아닙니다. 수신기 크래시/불확실한 접수는 자동 재출력하지 않습니다.

`GET jobs`는 claimed 작업도 processing 상태로 반환할 수 있으므로 waiting만 새로 처리합니다. 처리권 확보 후 수동 printed/dismissed는 409입니다. 대기는 최대 20건, 라벨 요청 본문은 최대 16KiB입니다. DK-22210은 size=dk22210, widthMm=29, heightMm=12~200(0.1mm 단위), copies=1~20이며 서버 허용 크기와 실제 QL-550 드라이버 지원/인쇄 가능 영역은 별도로 검사합니다.


## 라벨 상품명 표시 — 0.8.5

사용자 요청에 따라 새 라벨의 `label.name`은 괄호 안 성분명(중첩/전각 괄호 포함)과 밑줄 문자를 제거한 상품명으로 전달합니다. 예: `약국용타이레놀정500mg_(아세트아미노펜)` → `약국용타이레놀정500mg`. 제품 조회/입력 화면과 로컬 제품 저장에는 원문을 유지합니다. 그 밖의 라벨 필드와 claim/spooled 계약은 동일합니다.

**출력 레이아웃 요구:** 상품명은 한 줄만 표시하고 넘치는 부분은 말줄임(…) 처리합니다. 웹 미리보기/브라우저 인쇄에는 적용되어 있습니다. Windows 유팜데일리의 기존 GDI 템플릿도 이름 영역에 줄바꿈을 금지하고 실제 선택한 폰트의 측정 폭을 기준으로 말줄임해야 합니다. 전달되는 name은 정리된 상품명 전체이며 고정 글자 수로 잘라 보내지 않습니다. 로컬 GDI 수정/물리 출력 검증은 웹 배포만으로 적용되지 않습니다.


## 독립 PC 수신기와 자동 축소 — 0.8.6

유팜데일리를 사용하지 않는 PC용 수신기를 `integrations/pc-printer/`에 추가했습니다. 기존 수신 모듈은 변경하지 않고 DesktopReceiver가 heartbeat만 확장합니다. `receiver-heartbeat`에 선택 필드 `app: "pc-print-agent"`를 보내면 연결 응답에 같은 app이 표시됩니다. 필드 생략 시 기존처럼 `upharm-daily`이며 create/pair/claim/spooled/실패/만료 계약은 동일합니다.

웹 미리보기·브라우저 인쇄와 새 독립 Windows 출력기는 작은 용지에 맞춰 글자·간격·바코드 높이를 자동 축소하고 수량·날짜 등 전체 필드를 보존합니다. 상품명 한 줄 정책은 유지합니다. 용지 폭을 활용하며 웹 미리보기에서 축소 비율을 표시합니다. 물리 드라이버 용지 불일치는 내용 축소로 해결되지 않으므로 별도로 확인합니다.

**기존 UPharmStats GDI 경로는 이 웹 배포로 수정되지 않습니다.** 유팜데일리에서도 동일 동작을 적용하려면 해당 PC의 출력 레이아웃에 ‘전체 내용 측정 → 용지 내 높이에 맞는 최대 폰트/간격 배율 계산 → 한 줄 상품명과 필드 전체 출력’을 반영해야 합니다. 새 Print-Label.ps1의 Render-Content가 참고 구현입니다. API 추가 필드나 저장된 복약 정보를 요구하지 않습니다. 기존 인쇄 결과 저널/claim 흐름은 변경하지 마세요.

검증: 기존/독립 수신기 각각 성공, 결과 응답 유실, 크래시 후 재시작, 프린터 오류 후 재개; 동시 claim 단일 승자; ZIP 구성과 UTF-8 BOM; PowerShell 구문 및 Code 128 체크섬/디코딩; 모바일 소형 라벨 자동 축소와 전체 필드 보존. 실제 GDI/프린터 출력은 미실시.
