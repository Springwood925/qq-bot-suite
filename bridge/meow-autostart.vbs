' MEOW autostart -- brings DSH (:3080) and the QQ bot guard back after a reboot.
'
' Why this file exists: neither DSH nor qqbot-guard.vbs is registered anywhere
' (no Run key, no scheduled task, no Startup entry), so a Windows restart --
' including the forced update reboot -- left the whole stack dead with no
' visible symptom. A previous 08:30 start was done by hand in a console.
'
' What it does, in order:
'   1. log "begin"
'   2. if nothing listens on 3080, start DSH with cwd <workspace>, then wait up
'      to 180s for the port
'   3. if state\stop.flag exists, respect it: do NOT start the bot, only log
'      (??QQ???.vbs clears that flag when you start it by hand)
'   4. otherwise, if qqbot-guard.vbs is not already running, start it hidden
'   5. log "end"; show one message box ONLY if DSH never came up
'
' Everything runs hidden (window style 0): no popup, no browser tab. The
' visible launcher (??QQ???.vbs) is deliberately untouched for manual use.
'
' NOTE: .vbs must stay pure ASCII with CRLF line endings, and every filename it
' mentions literally must be ASCII too -- that is why this file is named
' meow-autostart.vbs and its comments are in English.
Option Explicit

Dim FSO, WS, ROOT, LOGFILE, NODE, DSHJS, DSHCWD, GUARD, FLAG
Dim i, dshUp, botUp, note

Set FSO = CreateObject("Scripting.FileSystemObject")
Set WS  = CreateObject("WScript.Shell")
ROOT = FSO.GetParentFolderName(WScript.ScriptFullName)

NODE   = "C:\Program Files\nodejs\node.exe"
DSHJS  = FindDshJs()
DSHCWD = FSO.GetParentFolderName(ROOT)
GUARD  = ROOT & "\qqbot-guard.vbs"
FLAG   = ROOT & "\state\stop.flag"
LOGFILE = ROOT & "\state\meow-autostart.log"

' Locate the dsh CLI entry under the npx cache (the folder hash is per-machine,
' so it must never be hard-coded). Returns "" when not found -- the caller
' already logs and skips in that case, which is the right behaviour on a
' machine that only uses the DSH desktop app.
Function FindDshJs()
  Dim base, folder, f
  FindDshJs = ""
  base = WS.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\npm-cache\_npx"
  If Not FSO.FolderExists(base) Then Exit Function
  On Error Resume Next
  For Each folder In FSO.GetFolder(base).SubFolders
    f = folder.Path & "\node_modules\@deepseek-ai\dsh\lib\bin.js"
    If FSO.FileExists(f) Then
      FindDshJs = f
      Exit Function
    End If
  Next
  On Error GoTo 0
End Function

' ---- helpers ------------------------------------------------------------

' True when something is LISTENING on that port (pure WMI: starts no process).
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

' Check the PROCESS, not just the port -- the guard's own spawn-storm fix.
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

Sub Log(t)
  Dim lf
  On Error Resume Next
  Set lf = FSO.OpenTextFile(LOGFILE, 8, True)
  lf.WriteLine Now & "  " & t
  lf.Close
  On Error GoTo 0
End Sub

' ---- main ---------------------------------------------------------------

Log "--- autostart begin ---"

' 1) DSH on 3080 (the bridge talks to it over HTTP; without it the bot is mute)
dshUp = PortUp(3080)
If dshUp Then
  Log "DSH already listening on 3080 -- skip"
Else
  If Not FSO.FileExists(DSHJS) Then
    Log "ERROR: dsh entry not found: " & DSHJS
  ElseIf Not FSO.FileExists(NODE) Then
    Log "ERROR: node not found: " & NODE
  Else
    Log "starting DSH: dsh web --no-open  (cwd " & DSHCWD & ")"
    WS.CurrentDirectory = DSHCWD
    WS.Run """" & NODE & """ """ & DSHJS & """ web --no-open", 0, False
    For i = 1 To 90                  ' 90 x 2s = up to 180s
      WScript.Sleep 2000
      If PortUp(3080) Then
        dshUp = True
        Exit For
      End If
    Next
    If dshUp Then
      Log "DSH is up on 3080 after about " & (i * 2) & "s"
    Else
      Log "ERROR: DSH did not open 3080 within 180s"
    End If
  End If
End If

' 2) bot guard (SnowLuma + bridge live inside it)
If FSO.FileExists(FLAG) Then
  Log "state\stop.flag present -- bot NOT started (by design)"
  note = note & "The bot was left stopped: state\stop.flag exists." & vbCrLf
ElseIf GuardRunning() Then
  Log "qqbot-guard.vbs already running -- skip"
ElseIf Not FSO.FileExists(GUARD) Then
  Log "ERROR: guard not found: " & GUARD
Else
  Log "starting qqbot-guard.vbs (hidden)"
  WS.Run "wscript.exe """ & GUARD & """", 0, False
End If

Log "--- autostart end ---"

' 3) only speak up when something is actually wrong
If Not dshUp Then
  MsgBox "MEOW autostart: DSH did not come up on port 3080." & vbCrLf & vbCrLf & _
         note & _
         "The QQ bot needs it, so the bot will not answer until DSH is up." & vbCrLf & vbCrLf & _
         "Log: " & LOGFILE, 48, "MEOW autostart"
End If
