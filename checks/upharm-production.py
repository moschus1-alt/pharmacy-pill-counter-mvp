import json
import re
from datetime import datetime, timezone
from urllib.error import HTTPError
from pathlib import Path
import sys
import tempfile
import time
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from uuid import uuid4
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'integrations' / 'upharm-daily'))
from pill_counter_relay import PillCounterReceiver, SPOOLED

API = 'https://pharmacy-pill-counter-mvp.vercel.app/api/print-relay'
def call(action, station='', token='', data=None, get=False):
    body = {'action': action, 'station': station, **(data or {})}
    request = Request(API + ('?' + urlencode(body) if get else ''),
        data=None if get else json.dumps(body).encode(), method='GET' if get else 'POST',
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
    with urlopen(request, timeout=30) as response:
        return json.load(response)

station = call('create', data={'name': '유팜데일리 연동 검증 PC'})
try:
    assert set(station) == {'id', 'name', 'ownerToken', 'pairToken', 'expiresAt'}
    assert re.fullmatch(r'[0-9]{13}-[a-f0-9]{32}', station['id'])
    assert re.fullmatch(r'[a-f0-9]{64}', station['ownerToken'])
    assert re.fullmatch(r'[a-f0-9]{64}', station['pairToken'])
    assert station['ownerToken'] != station['pairToken']
    assert type(station['expiresAt']) is int
    assert 28800000 <= station['expiresAt'] - int(station['id'].split('-')[0]) < 28801000
    assert datetime.fromtimestamp(station['expiresAt'] / 1000, timezone.utc).year >= 2026
    paired = call('pair', station['id'], station['pairToken'])
    assert paired['expiresAt'] == station['expiresAt'] and paired['receiver'] is None
    try:
        call('jobs', station['id'], station['pairToken'], get=True)
        raise AssertionError('sender must not fetch label jobs')
    except HTTPError as error:
        assert error.code == 403
    label = {'code': '8806723002015', 'name': '유팜데일리 연동 테스트', 'strength': '500 mg',
        'manufacturer': '', 'lot': 'TEST', 'count': 8, 'packedOn': '2026-10-19', 'expiry': '2029-12-31',
        'useBy': '', 'size': 'dk22210', 'widthMm': 29, 'heightMm': 90, 'copies': 1}
    job_id = str(uuid4())
    call('submit', station['id'], station['pairToken'], {'jobId': job_id, 'label': label})
    calls = []
    def test_printer(received):
        assert received == label
        calls.append(received)
        return SPOOLED  # Test adapter: never sends a physical print.
    with tempfile.TemporaryDirectory() as directory:
        config = {'schemaVersion': 1, 'apiUrl': API, 'stationId': station['id'], 'ownerToken': station['ownerToken']}
        client = PillCounterReceiver(config, test_printer, printer_name='Brother QL-550 (검증 대역)', journal_dir=directory)
        for _ in range(10):
            client.poll_once()
            if calls:
                break
            time.sleep(2)
        assert len(calls) == 1
        client.poll_once()
        assert len(calls) == 1
        assert call('status', station['id'], station['pairToken'], {'jobId': job_id}, True)['status'] == 'spooled'
        state = call('connection', station['id'], station['pairToken'], get=True)
        assert state['receiver']['app'] == 'upharm-daily' and state['receiver']['online']
        assert call('jobs', station['id'], station['ownerToken'], get=True)['jobs'] == []
        assert state['expiresAt'] == station['expiresAt']
        assert state['receiver']['state'] == 'ready'
        job_entry_id = next(iter(json.loads(client._journal_path.read_text())['pending']), None)
        assert job_entry_id is None
        assert call('claim', station['id'], station['ownerToken'], {'jobId': job_id, 'receiverId': str(uuid4()), 'claimId': str(uuid4())}) == {'claimed': False}
        client.stop()
    print('PASS create types/epoch-ms/8h TTL/key scopes, pairing, non-renewing heartbeat and duplicate claim')
    print('PASS production private Blob relay → Python receiver → single print callback → spooled status; physical printer not exercised')
finally:
    call('close', station['id'], station['ownerToken'])
    try:
        call('connection', station['id'], station['pairToken'], get=True)
        raise AssertionError('closed connection must be revoked')
    except HTTPError as error:
        assert error.code == 410
    print('PASS closed connection returns 410; no tokens emitted')
