"""Standalone Windows receiver. Uses the same durable claim journal as UPharmDaily."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pill_counter_relay import PillCounterReceiver, PrintRejected, SPOOLED


class DesktopReceiver(PillCounterReceiver):
    def _heartbeat(self, state):
        self._request('receiver-heartbeat', {'receiverId': self._journal['receiverId'],
            'printerName': self._printer_name, 'state': state, 'app': 'pc-print-agent'})
        self._heartbeat_at = time.monotonic()


def print_label(label, printer, *, run=subprocess.run):
    # The temporary label is local only and removed even when the driver fails.
    with tempfile.TemporaryDirectory(prefix='pill-label-') as directory:
        path = Path(directory) / 'label.json'
        path.write_text(json.dumps(label, ensure_ascii=False), encoding='utf-8')
        result = run([str(Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'),
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
            str(Path(__file__).with_name('Print-Label.ps1')), '-LabelPath', str(path), '-PrinterName', printer],
            capture_output=True, timeout=180)
        if result.returncode != 0 or result.stdout.strip() != b'SPOOLED':
            raise PrintRejected('layout' if result.returncode == 2 else 'uncertain')
    return SPOOLED


def main():
    import ctypes
    import msvcrt
    config = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
    printer = sys.argv[2]
    # A second process must not share the journal or overwrite its receiver ID.
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
    kernel.CreateMutexW.restype = ctypes.c_void_p
    handle = kernel.CreateMutexW(None, False, 'Local\\PillCounter-' + config['stationId'])
    if not handle or ctypes.get_last_error() == 183:
        print('이미 실행 중인 출력 연결 창을 확인해 주세요.')
        return
    stopped = False
    def event(info):
        nonlocal stopped
        messages = {'spooled': '프린터에 전달했어요.', 'failed': '출력 확인 필요. 실제 출력물과 용지를 확인한 뒤 R을 누르세요.',
                    'connection_error': '서버 재연결 중…', 'expired': '연결이 만료됐어요. PC 웹 화면에서 새 연결 파일을 받아 주세요.'}
        if info['state'] in messages:
            print(messages[info['state']], flush=True)
        if info['state'] == 'expired':
            stopped = True
    client = DesktopReceiver(config, lambda label: print_label(label, printer), printer_name=printer,
        journal_dir=Path(os.environ['LOCALAPPDATA']) / 'PillCounter' / 'journal', on_event=event)
    print('자동 출력 연결 중 · ' + printer)
    print('이 창을 켜 두세요. 웹 브라우저는 닫아도 됩니다. 종료: Q / 오류 확인 후 재개: R')
    if client._paused:
        print('이전 출력 결과를 확인해야 해요. 확인 후 R을 누르세요.')
    client.start()
    try:
        while not stopped:
            if msvcrt.kbhit():
                key = msvcrt.getwch().lower()
                if key == 'q':
                    break
                if key == 'r':
                    client.resume()
            time.sleep(.2)
    finally:
        client.stop()
        if client._thread:
            client._thread.join()  # Finish an in-flight spool/result before exit.
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel.CloseHandle(handle)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception:
        print('출력 연결을 시작하지 못했어요. 연결 파일과 프린터를 확인해 주세요.')
        sys.exit(1)
