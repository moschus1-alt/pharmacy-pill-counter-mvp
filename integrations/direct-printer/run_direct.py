"""Standalone Windows entry; UPharmDaily can instantiate the server directly."""
import argparse
import ctypes
import os
from pathlib import Path
import sys
import time
import webbrowser
sys.path.insert(0,str(Path(__file__).resolve().parent))
from direct_server import DirectPrinterServer
# Reuse the tested Windows GDI/PrintDocument adapter, not a browser print dialog.
from receiver import print_label

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--host',required=True);parser.add_argument('--printer',required=True);args=parser.parse_args()
    root=Path(__file__).resolve().parent
    kernel=ctypes.WinDLL('kernel32',use_last_error=True);kernel.CreateMutexW.argtypes=[ctypes.c_void_p,ctypes.c_bool,ctypes.c_wchar_p];kernel.CreateMutexW.restype=ctypes.c_void_p
    handle=kernel.CreateMutexW(None,False,'Local\\PillCounterDirectPrinter')
    if not handle or ctypes.get_last_error()==183:raise RuntimeError('직접 연결 프로그램이 이미 실행 중이에요. 기존 창을 확인해 주세요.')
    server=None
    try:
        server=DirectPrinterServer(lambda label:print_label(label,args.printer),printer_name=args.printer,host=args.host,web_root=root/'web',catalog_dir=root/'data',data_dir=Path(os.environ['LOCALAPPDATA'])/'PillCounterDirect'/'state')
        server.start();webbrowser.open(server.admin_url)
        print('PC 직접 수신 중 · '+args.printer,flush=True)
        print('휴대폰은 같은 공유기에 연결하세요. PC 연결 창의 QR을 읽으세요.',flush=True)
        print('프로그램 창을 닫으면 수신이 멈춥니다. 종료: Ctrl+C',flush=True)
        while True:time.sleep(1)
    finally:
        if server:server.stop()
        kernel.CloseHandle.argtypes=[ctypes.c_void_p];kernel.CloseHandle(handle)
if __name__=='__main__':
    try:main()
    except KeyboardInterrupt:pass
    except Exception as error:
        print('시작 실패: '+str(error),flush=True);sys.exit(1)
