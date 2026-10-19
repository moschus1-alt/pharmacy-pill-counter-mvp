import json
from pathlib import Path
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'integrations' / 'upharm-daily'))
from pill_counter_relay import PillCounterReceiver, PrintRejected, SPOOLED
config = json.loads(Path(sys.argv[1]).read_text())
scenario = sys.argv[2]
calls = []

def existing_print(label):
    calls.append(label)
    assert label['name'] == '연동검증정'
    assert label['count'] == 8
    assert label['size'] == 'dk22210' and label['widthMm'] == 29 and label['heightMm'] == 90
    assert label['lot'] == 'LOT001' and label['expiry'] == '2029-12-31'
    if scenario == 'crash':
        raise SystemExit('simulated process termination after handing off to printer')
    if scenario == 'printer-error' and len(calls) == 1:
        raise PrintRejected('printer')
    return SPOOLED

with tempfile.TemporaryDirectory() as directory:
    def receiver():
        return PillCounterReceiver(config, existing_print, printer_name='Brother QL-550', journal_dir=directory, allow_local_http=True)
    client = receiver()
    if scenario == 'lost-ack':
        try:
            client.poll_once()
            raise AssertionError('expected lost acknowledgement response')
        except (ConnectionError, OSError):
            pass
        assert len(calls) == 1
        # Restart from the durable pending result. Only acknowledgement retries.
        client = receiver()
        client.poll_once()
        assert len(calls) == 1
    elif scenario == 'crash':
        try:
            client.poll_once()
            raise AssertionError('expected simulated termination')
        except SystemExit:
            pass
        client = receiver()
        client.poll_once()
        assert len(calls) == 1 and client._paused
    elif scenario == 'printer-error':
        client.poll_once()
        assert len(calls) == 1 and client._paused
        client = receiver()
        client.poll_once()
        assert len(calls) == 1 and client._paused
        client.resume()
        client.poll_once()
        assert len(calls) == 2
    else:
        client.poll_once()
        client.poll_once()
        assert len(calls) == 1
    client.stop()
print('PASS Python receiver: ' + scenario)
