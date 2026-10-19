' Restart the QQ bot by composing the existing stop and start scripts.
' Why this file exists: restart.bat is an upstream script that prints to a console
' nobody watches. It gives no popup, does not reopen the console page, and can
' leave a stale stop.flag behind. This one reuses the two scripts the user
' already knows:
'   1) the STOP script  - writes state\stop.flag and kills whatever listens on 3100
'   2) delete state\stop.flag - otherwise the guard would exit the moment it starts
'   3) the START script - starts guard if needed, then shows status and opens console
'
' NOTE 1: .vbs must stay pure ASCII with CRLF line endings. That is exactly why the
'         two scripts below are named with ChrW() instead of literal Chinese text:
'         an earlier version had the Chinese names written literally, the editor
'         replaced every one of those bytes with a plain question mark, and the
'         script died with "Missing: <root>\<7 question marks>.vbs" no matter
'         what. Do NOT type the Chinese names back in here - build them from
'         code points, or the same bug returns.
' NOTE 2: ChrW() yields a real Unicode string, and FileSystemObject handles it
'         correctly (the ASCII-only rule applies to the FILE, not to PowerShell
'         or to the strings a script builds at run time).
Option Explicit

Dim FSO, WS, ROOT, FLAG, STOPVBS, STARTVBS, rc

Set FSO = CreateObject("Scripting.FileSystemObject")
Set WS = CreateObject("WScript.Shell")
ROOT = FSO.GetParentFolderName(WScript.ScriptFullName)

' STOP script name, built from code points (see NOTE 1).
STOPVBS = ROOT & "\" & ChrW(20572) & ChrW(27490) & "QQ" & ChrW(26426) & ChrW(22120) & ChrW(20154) & ".vbs"
' START script name, built from code points (see NOTE 1).
STARTVBS = ROOT & "\" & ChrW(21551) & ChrW(21160) & "QQ" & ChrW(26426) & ChrW(22120) & ChrW(20154) & ".vbs"
FLAG = ROOT & "\state\stop.flag"

If Not FSO.FileExists(STOPVBS) Then
  MsgBox "Missing: " & STOPVBS, 16, "QQ robot"
  WScript.Quit 1
End If
If Not FSO.FileExists(STARTVBS) Then
  MsgBox "Missing: " & STARTVBS, 16, "QQ robot"
  WScript.Quit 1
End If

' Step 1: stop (blocking, so the port is free before we start again).
rc = WS.Run("wscript.exe """ & STOPVBS & """", 1, True)

' Step 2: clear the flag the stop script just wrote, or the fresh guard exits at once.
If FSO.FileExists(FLAG) Then
  On Error Resume Next
  FSO.DeleteFile FLAG, True
  On Error GoTo 0
End If

WScript.Sleep 1500

' Step 3: start (it shows its own progress popup and opens the console page).
WS.Run "wscript.exe """ & STARTVBS & """", 1, False
