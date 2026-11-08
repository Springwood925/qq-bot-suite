"""Follow the verified QQ call window and answer its incoming audio call."""
import ctypes,json,os,time,subprocess,sys
from ctypes import wintypes
user=ctypes.windll.user32;kernel=ctypes.windll.kernel32
user.IsWindowVisible.argtypes=[wintypes.HWND];user.IsWindowVisible.restype=wintypes.BOOL
user.GetWindowTextLengthW.argtypes=[wintypes.HWND];user.GetWindowTextLengthW.restype=ctypes.c_int
user.GetWindowTextW.argtypes=[wintypes.HWND,wintypes.LPWSTR,ctypes.c_int];user.GetWindowTextW.restype=ctypes.c_int
user.GetWindowThreadProcessId.argtypes=[wintypes.HWND,ctypes.POINTER(wintypes.DWORD)]
kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD];kernel.OpenProcess.restype=wintypes.HANDLE
kernel.QueryFullProcessImageNameW.argtypes=[wintypes.HANDLE,wintypes.DWORD,wintypes.LPWSTR,ctypes.POINTER(wintypes.DWORD)]
kernel.CloseHandle.argtypes=[wintypes.HANDLE]
CALLBACK=ctypes.WINFUNCTYPE(wintypes.BOOL,wintypes.HWND,wintypes.LPARAM)
user.EnumWindows.argtypes=[CALLBACK,wintypes.LPARAM]
def snapshot():
 found=[];errors=[]
 @CALLBACK
 def visit(hwnd,_):
  if not user.IsWindowVisible(hwnd):return True
  length=user.GetWindowTextLengthW(hwnd)
  if length<=0:return True
  title=ctypes.create_unicode_buffer(length+1);user.GetWindowTextW(hwnd,title,len(title))
  if title.value!='语音通话':return True
  pid=wintypes.DWORD();user.GetWindowThreadProcessId(hwnd,ctypes.byref(pid))
  handle=kernel.OpenProcess(0x1000,False,pid.value)
  if not handle:errors.append('无法核验通话窗口进程');return True
  try:
   size=wintypes.DWORD(32768);buf=ctypes.create_unicode_buffer(size.value)
   if not kernel.QueryFullProcessImageNameW(handle,0,buf,ctypes.byref(size)):errors.append('无法读取通话进程');return True
   if os.path.basename(buf.value).lower()=='qq.exe':found.append(int(hwnd))
  finally:kernel.CloseHandle(handle)
  return True
 if not user.EnumWindows(visit,0):raise RuntimeError('无法读取窗口状态')
 if errors:raise RuntimeError(errors[0])
 if len(found)>1:raise RuntimeError('多个通话窗口，无法确认')
 return found[0] if found else None
helper=subprocess.Popen(['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',os.path.join(os.path.dirname(__file__),'qq-accessibility.ps1')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf-8',creationflags=subprocess.CREATE_NO_WINDOW)
def query(cmd,hwnd):
 helper.stdin.write(f'{cmd} {hwnd}\n');helper.stdin.flush()
 result=json.loads(helper.stdout.readline())
 if 'error' in result:raise RuntimeError(result['error'])
 return result
attempted=None;last_attempt=0
while True:
 try:
  hwnd=snapshot()
  if hwnd is None:state={'state':'idle'};attempted=None
  else:
   buttons=set(query('read',hwnd).get('buttons','').splitlines())
   if '接听' in buttons and '退出通话' not in buttons:
    state={'state':'ringing'}
    if hwnd!=attempted or time.monotonic()-last_attempt>3:
     attempted=hwnd;last_attempt=time.monotonic();query('accept',hwnd)
   elif '退出通话' in buttons and '接听' not in buttons:state={'state':'active'}
   else:state={'state':'unknown'}
 except Exception:state={'state':'unknown'}
 print(json.dumps(state),flush=True)
 time.sleep(0.7)
