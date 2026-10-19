' QQ bot guard: keeps SnowLuma (gateway) and qq-bridge (bot) alive.
' Started hidden by the launcher. Never shows a window -- all user-visible
' feedback belongs to the launcher, this file is the silent watchdog.
' Stop it by running the stop script: it writes state\stop.flag and kills
' whatever listens on 3100, which makes this loop see the flag and exit.
'
' ---------------------------------------------------------------------------
' 2026-09-18 FIX -- the spawn storm.
'
' The first version only asked "is the port up?" before starting SnowLuma.
' That is wrong when SnowLuma is RUNNING BUT NOT LOGGED IN: it starts fine,
' serves its WebUI, never opens the OneBot ports, and the guard -- seeing no
' port -- started another copy. Every 3 seconds. It reached 33 processes
' before anyone noticed, all fighting over port 5099.
'
' Two changes:
'   1. Never start a process that is already running. Check the PROCESS, not
'      just the port. (SnowProcAlive / BridgeProcAlive below.)
'   2. If a process is alive but its port never comes up, stop retrying and
'      TELL THE HUMAN -- this is the one failure a watchdog cannot fix by
'      itself, because it needs someone to log the QQ account back in.
'
' ---------------------------------------------------------------------------
' 2026-09-27 FIX -- SnowLuma was never actually being watched.
'
' NOTE: the 2026-09-18 comment above already said this check should be
' "SnowProcAlive / BridgeProcAlive" -- two separate probes. It ended up
' implemented as ONE generic ProcAlive(marker) instead. This restores the
' split for the gateway; the bridge probe below is fine as it is.
'
' ProcAlive matched the substring "snowluma" anywhere in a node.exe command
' line. The DSH tool child
'     <bridge>\src\mcp-snowluma-safe.js
' contains that substring, and it lives exactly as long as DSH does. So while
' SnowLuma was really dead the guard still believed it was alive: it bumped
' stuckSnow on every pass, never restarted it, and never warned either (that
' warning also needs 3100 to be down). SnowLuma stayed dead for 4h48m.
'
' SnowProcAlive() below matches the EXECUTABLE PATH against our own SNOWEXE
' instead. Every MCP child runs C:\Program Files\nodejs\node.exe, so no tool
' process can ever be mistaken for the gateway.
'
' NOTE: .vbs must stay pure ASCII with CRLF line endings, and every filename
' it mentions must be ASCII too -- that is why the guard is qqbot-guard.vbs.
' The Chinese help text lives in an HTML file, which has no such limit.
Option Explicit

Dim FSO, WS, ROOT, NODE, SNOWDIR, SNOWEXE, SNOWJS, BRIDGE, FLAG, HELPURL
Dim stuckSnow, stuckBridge, warned, i, snowRestarts, bridgeRestarts

Set FSO = CreateObject("Scripting.FileSystemObject")
Set WS = CreateObject("WScript.Shell")
ROOT = FSO.GetParentFolderName(WScript.ScriptFullName)
NODE = "C:\Program Files\nodejs\node.exe"
SNOWDIR = ResolveSnowDir()
SNOWEXE = SNOWDIR & "\node.exe"
SNOWJS = SNOWDIR & "\index.mjs"
BRIDGE = ROOT & "\src\bridge.js"
FLAG = ROOT & "\state\stop.flag"
HELPURL = "file:///" & Replace(ROOT & "\help.html", "\", "/")

' Where SnowLuma lives. Order:
'   1) snowluma-path.txt next to this script (written by the DSH plugin when
'      it generates config.json -- that is how a shared copy finds SnowLuma);
'   2) the default install path used by the author's machine.
' Everything is relative to ROOT, so the whole folder can be moved anywhere.
Function ResolveSnowDir()
  Dim p, ts, line
  ResolveSnowDir = "E:\QQAgent\QQ Agent\resources\app\snowluma"
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

stuckSnow = 0
stuckBridge = 0
warned = False
snowRestarts = 0
bridgeRestarts = 0

' True when something is LISTENING on that port. Pure WMI query: starts no
' process at all, so nothing can flash on screen.
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

' Is a node process already running that script? Matching on the script path in
' the command line is the only reliable way in VBScript -- and it is what keeps
' the guard from spawning a second copy of something that is already alive.
Function ProcAlive(marker)
  Dim wmi, col, q
  ProcAlive = False
  On Error Resume Next
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  Set col = wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='node.exe'")
  If Err.Number = 0 Then
    If Not col Is Nothing Then
      For Each q In col
        If Not IsNull(q.CommandLine) Then
          If InStr(1, q.CommandLine, marker, 1) > 0 Then ProcAlive = True
        End If
      Next
    End If
  End If
  On Error GoTo 0
End Function
' True only for the gateway itself. Compares the executable path, because a
' command-line substring match is exactly what caused the 2026-09-27 outage.
Function SnowProcAlive()
  Dim wmi, col, q, ep
  SnowProcAlive = False
  On Error Resume Next
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  Set col = wmi.ExecQuery("SELECT ExecutablePath FROM Win32_Process WHERE Name='node.exe'")
  If Err.Number = 0 Then
    If Not col Is Nothing Then
      For Each q In col
        ep = q.ExecutablePath
        If Not IsNull(ep) Then
          If LCase(ep) = LCase(SNOWEXE) Then SnowProcAlive = True
        End If
      Next
    End If
  End If
  On Error GoTo 0
End Function
'

' Kill the real SnowLuma. Used when the process is alive but its OneBot ports
' never come up -- the usual cause is that QQ was not logged in yet when it
' started (boot order), so the injection failed and the process is stuck.
' Uses WMI to find the pid, then taskkill: wmic.exe is gone since Windows 11 24H2.
Sub KillSnowLuma()
  Dim wmi, col, q, ep
  On Error Resume Next
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  Set col = wmi.ExecQuery("SELECT ProcessId, ExecutablePath FROM Win32_Process WHERE Name='node.exe'")
  If Err.Number = 0 Then
    If Not col Is Nothing Then
      For Each q In col
        ep = q.ExecutablePath
        If Not IsNull(ep) Then
          If LCase(ep) = LCase(SNOWEXE) Then
            WS.Run "taskkill /F /PID " & q.ProcessId, 0, True
          End If
        End If
      Next
    End If
  End If
  On Error GoTo 0
End Sub

Sub StartSnowLuma()
  WS.CurrentDirectory = SNOWDIR
  WS.Run """" & SNOWEXE & """ """ & SNOWJS & """", 0, False
End Sub

' Kill the bridge process. Same reasoning as KillSnowLuma: a stuck bridge
' (process alive, port never opens) will never recover on its own.
Sub KillBridge()
  Dim wmi, col, q, cl
  On Error Resume Next
  Set wmi = GetObject("winmgmts:\\.\root\cimv2")
  Set col = wmi.ExecQuery("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='node.exe'")
  If Err.Number = 0 Then
    If Not col Is Nothing Then
      For Each q In col
        cl = q.CommandLine
        If Not IsNull(cl) Then
          If InStr(1, LCase(cl), "bridge.js", 1) > 0 Then
            WS.Run "taskkill /F /PID " & q.ProcessId, 0, True
          End If
        End If
      Next
    End If
  End If
  On Error GoTo 0
End Sub

Sub StartBridge()
  WS.CurrentDirectory = ROOT
  WS.Run """" & NODE & """ """ & BRIDGE & """", 0, False
End Sub

Sub TellHuman()
  ' Watchdog gave up: the one thing it cannot fix is a logged-out QQ account.
  ' Open the help page (UTF-8 HTML, so it can be in Chinese) and stop retrying.
  If warned Then Exit Sub
  warned = True
  On Error Resume Next
  WS.Run HELPURL, 1, False
  WS.Popup "SnowLuma is running but QQ is NOT logged in." & vbCrLf & vbCrLf & _
           "Automatic restart has been paused (it would just pile up copies)." & vbCrLf & vbCrLf & _
           "A help page just opened -- log the QQ account back in there," & vbCrLf & _
           "then double-click the desktop shortcut again.", _
           0, "QQ robot needs you", 48
  On Error GoTo 0
End Sub

' Drop a stale flag left over from a previous stop.
If FSO.FileExists(FLAG) Then FSO.DeleteFile FLAG, True

' 1) gateway first -- the bot needs it to reach QQ at all.
If Not PortUp(3001) Then
  If Not SnowProcAlive() Then
    StartSnowLuma
    WScript.Sleep 20000
  End If
End If

' 2) Watch BOTH ports on every pass.
Do
  If FSO.FileExists(FLAG) Then
    FSO.DeleteFile FLAG, True
    Exit Do
  End If

  ' ---- SnowLuma ------------------------------------------------------------
  If Not PortUp(3001) Then
    If SnowProcAlive() Then
      ' Alive but not serving. Two causes:
      '   a) boot order -- QQ was not logged in yet, so the injection failed
      '      and this process is stuck forever (the common case right after boot)
      '   b) it really is waiting for a QR login (rare, user must act)
      ' The old version only counted passes and waited for a human, which meant
      ' the bot never came up by itself after a reboot. Now: after 5 passes
      ' (~15s) still no port, kill it and start our own copy again -- but only ONCE.
      stuckSnow = stuckSnow + 1
      If stuckSnow >= 5 Then
        snowRestarts = snowRestarts + 1
        If snowRestarts <= 3 Then
          KillSnowLuma
          stuckSnow = 0
          WScript.Sleep 3000
          StartSnowLuma
          ' Back off a little more on every attempt: 20s, 40s, 60s.
          WScript.Sleep 20000 * snowRestarts
        Else
          TellHuman
          stuckSnow = 0
          ' Do NOT give up forever (2026-10-20): a second stall 17s after a
          ' successful restart used to leave the bot dead until a human
          ' noticed. Warn once, wait a minute, hand the quota back, try again.
          snowRestarts = 0
          WScript.Sleep 60000
        End If
      End If
    Else
      stuckSnow = 0
      StartSnowLuma
      WScript.Sleep 20000
    End If
  Else
    stuckSnow = 0
    snowRestarts = 0
  End If

  ' ---- bridge --------------------------------------------------------------
  If Not PortUp(3100) Then
    If ProcAlive("bridge.js") Then
      ' Same retry policy as SnowLuma: a bridge whose process is alive but
      ' whose port never opens is stuck; restart it a few times, then give up.
      stuckBridge = stuckBridge + 1
      If stuckBridge >= 5 Then
        bridgeRestarts = bridgeRestarts + 1
        If bridgeRestarts <= 3 Then
          KillBridge
          stuckBridge = 0
          WScript.Sleep 2000
          StartBridge
          WScript.Sleep 12000 * bridgeRestarts
        Else
          TellHuman
          stuckBridge = 0
          ' Same policy as SnowLuma above: cooldown, then retry.
          bridgeRestarts = 0
          WScript.Sleep 60000
        End If
      End If
    Else
      stuckBridge = 0
      StartBridge
      WScript.Sleep 12000
    End If
  Else
    stuckBridge = 0
    bridgeRestarts = 0
  End If

  WScript.Sleep 3000
Loop
