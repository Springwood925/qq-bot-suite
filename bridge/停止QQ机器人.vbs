' Stop the QQ bot started by the guard script.
' 1) writes state\stop.flag so the guard exits instead of restarting the bot
' 2) kills whatever process is LISTENING on 3100 (the bridge), found by port
'    so no process-name or command-line matching is involved
' SnowLuma (port 3001) is intentionally left running.
'
' NOTE: .vbs must stay pure ASCII with CRLF line endings.
Option Explicit

Dim FSO, WS, ROOT, f, wmi, col, c, killed, pid

Set FSO = CreateObject("Scripting.FileSystemObject")
Set WS = CreateObject("WScript.Shell")
ROOT = FSO.GetParentFolderName(WScript.ScriptFullName)

Set f = FSO.CreateTextFile(ROOT & "\state\stop.flag", True)
f.WriteLine "stop"
f.Close

killed = 0
On Error Resume Next
Set wmi = GetObject("winmgmts:\\.\root\StandardCimv2")
Set col = wmi.ExecQuery("SELECT OwningProcess FROM MSFT_NetTCPConnection " & _
                        "WHERE LocalPort=3100 AND State=2")
If Not col Is Nothing Then
  For Each c In col
    pid = c.OwningProcess
    WS.Run "taskkill /PID " & pid & " /T /F", 0, True
    killed = killed + 1
  Next
End If
On Error GoTo 0

WScript.Sleep 2000
If killed > 0 Then
  MsgBox "QQ bot stopped." & vbCrLf & "Guard flag written, bridge killed.", 64, "QQ bot"
Else
  MsgBox "QQ bot was not running." & vbCrLf & "Guard flag written.", 64, "QQ bot"
End If
