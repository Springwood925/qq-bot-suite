' QQ bot launcher -- the thing the desktop shortcut runs.
'
' Why this file exists: the old shortcut pointed straight at the silent guard,
' so double-clicking it produced NO feedback at all. You could not tell whether
' the bot had started, was already running, or had failed. This launcher does
' the visible half (checks, starts, reports) and then hands the invisible half
' (staying alive) to qqbot-guard.vbs.
'
' Every popup auto-closes after a few seconds, so this script can never sit
' there waiting for a click that never comes.
'
' NOTE: .vbs must stay pure ASCII with CRLF line endings, and every filename
' it mentions must be ASCII too -- that is why the guard is qqbot-guard.vbs.
Option Explicit

Dim FSO, WS, ROOT, NODE, SNOWDIR, SNOWEXE, SNOWJS, BRIDGE, GUARD, FLAG
Dim wa, wb, i, ok

Set FSO = CreateObject("Scripting.FileSystemObject")
Set WS = CreateObject("WScript.Shell")
ROOT = FSO.GetParentFolderName(WScript.ScriptFullName)
NODE = "C:\Program Files\nodejs\node.exe"
SNOWDIR = ResolveSnowDir()
SNOWEXE = SNOWDIR & "\node.exe"
SNOWJS = SNOWDIR & "\index.mjs"
BRIDGE = ROOT & "\src\bridge.js"
GUARD = ROOT & "\qqbot-guard.vbs"
FLAG = ROOT & "\state\stop.flag"

' Where SnowLuma lives: snowluma-path.txt next to this script wins, else the
' author's default install path. Keeps the folder movable / shareable.
Function ResolveSnowDir()
  Dim p, ts, line
  ResolveSnowDir = ""
  p = ROOT & "\snowluma-path.txt"
  If Not FSO.FileExists(p) Then Exit Function
  On Error Resume Next
  Set ts = FSO.OpenTextFile(p, 1)
  If Err.Number = 0 Then
    line = Trim(ts.ReadLine())
    ts.Close
    If Len(line) > 0 Then ResolveSnowDir = line
  End If
  On Error GoTo 0
End Function

Function PortUp(p)
  Dim wmi, col
  PortUp = False
  On Error Resume Next
  Set wmi = GetObject("winmgmts:\\.\root\StandardCimv2")
  Set col = wmi.ExecQuery("SELECT LocalPort FROM MSFT_NetTCPConnection " & _
                          "WHERE LocalPort=" & p & " AND State=2")
  If Err.Number = 0 Then
    If Not col Is Nothing Then
      If col.Count > 0 Then PortUp = True
    End If
  End If
  On Error GoTo 0
End Function

Function GuardRunning()
  Dim wmi, col, q
  GuardRunning = False
  On Error Resume Next
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  Set col = wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='wscript.exe'")
  If Not col Is Nothing Then
    For Each q In col
      If Not IsNull(q.CommandLine) Then
        If InStr(1, q.CommandLine, "qqbot-guard.vbs", 1) > 0 Then GuardRunning = True
      End If
    Next
  End If
  On Error GoTo 0
End Function

Function TF(cond, a, b)
  If cond Then TF = a Else TF = b
End Function

' Open the bridge console with the token already in the URL, so there is a real
' live status page instead of a popup that disappears.
Sub OpenConsole()
  Dim f, tok
  On Error Resume Next
  Set f = FSO.OpenTextFile(ROOT & "\state\console-token", 1)
  tok = Trim(f.ReadAll)
  f.Close
  On Error GoTo 0
  If tok = "" Then Exit Sub
  WS.Run "http://127.0.0.1:3100/?token=" & tok, 1, False
End Sub

Sub StartGuard()
  If GuardRunning() Then Exit Sub
  WS.CurrentDirectory = ROOT
  WS.Run "wscript.exe """ & GUARD & """", 0, False
End Sub

' A previous stop may have left the flag behind; clear it or the guard would
' exit the moment it starts.
If FSO.FileExists(FLAG) Then FSO.DeleteFile FLAG, True

wa = PortUp(3001)
wb = PortUp(3100)

' ---- Case 1: everything already up -----------------------------------------
If wa And wb Then
  StartGuard
  WS.Popup "QQ robot is ALREADY RUNNING." & vbCrLf & vbCrLf & _
           "  SnowLuma gateway : online" & vbCrLf & _
           "  Bot bridge       : online" & vbCrLf & _
           "  Watchdog         : on" & vbCrLf & vbCrLf & _
           "Opening the console so you can see the live status.", _
           10, "QQ robot", 64
  OpenConsole
  WScript.Quit 0
End If

' ---- Case 2: need to start something ---------------------------------------
WS.Popup "Starting the QQ robot..." & vbCrLf & vbCrLf & _
         "This takes about 30 seconds. Please do not click again." & vbCrLf & _
         "Another message will appear when it is done.", _
         4, "QQ robot", 64

If Not wa Then
  WS.CurrentDirectory = SNOWDIR
  WS.Run """" & SNOWEXE & """ """ & SNOWJS & """", 0, False
  For i = 1 To 30
    WScript.Sleep 1000
    If PortUp(3001) Then Exit For
  Next
End If

If Not PortUp(3100) Then
  WS.CurrentDirectory = ROOT
  WS.Run """" & NODE & """ """ & BRIDGE & """", 0, False
  For i = 1 To 30
    WScript.Sleep 1000
    If PortUp(3100) Then Exit For
  Next
End If

StartGuard
WScript.Sleep 2000

' ---- Report ----------------------------------------------------------------
wa = PortUp(3001)
wb = PortUp(3100)
ok = wa And wb

If ok Then
  WS.Popup "QQ robot STARTED." & vbCrLf & vbCrLf & _
           "  SnowLuma gateway : online" & vbCrLf & _
           "  Bot bridge       : online" & vbCrLf & _
           "  Watchdog         : on (restarts it if it crashes)" & vbCrLf & vbCrLf & _
           "Opening the console so you can see the live status.", _
           12, "QQ robot", 64
  OpenConsole
Else
  WS.Popup "QQ robot FAILED TO START." & vbCrLf & vbCrLf & _
           "  SnowLuma gateway : " & TF(wa, "online", "NOT running") & vbCrLf & _
           "  Bot bridge       : " & TF(wb, "online", "NOT running") & vbCrLf & vbCrLf & _
           "Check the log:" & vbCrLf & ROOT & "\state\bridge.log", _
           25, "QQ robot", 48
End If
