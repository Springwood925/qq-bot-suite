$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -ReferencedAssemblies Accessibility -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Accessibility;
public static class QQCallAccess {
  [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IAccessible obj);
  [DllImport("oleacc.dll")] static extern int AccessibleChildren(IAccessible parent, int start, int count, [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex=2)] object[] children, out int obtained);
  static void Walk(IAccessible a, int depth, List<string> names, List<string> buttons) {
    if (a == null || depth > 32 || names.Count > 600) return;
    try {
      string n = a.get_accName(0); if (!String.IsNullOrEmpty(n)) names.Add(n);
      object role = a.get_accRole(0); if (role is int && (int)role == 43 && !String.IsNullOrEmpty(n)) buttons.Add(n);
      int count = Math.Min(a.accChildCount, 300); if (count <= 0) return;
      object[] children = new object[count]; int got; if (AccessibleChildren(a, 0, count, children, out got) != 0) return;
      for (int i=0; i<got; i++) {
        IAccessible child = children[i] as IAccessible;
        if (child != null) Walk(child, depth+1, names, buttons);
        else if (children[i] is int) { object id=children[i]; string name=a.get_accName(id); if (!String.IsNullOrEmpty(name)) { names.Add(name); object r=a.get_accRole(id); if(r is int && (int)r==43) buttons.Add(name); } }
      }
    } catch (COMException) { }
  }
  public static string[] Read(long hwnd) {
    Guid iid = new Guid("618736e0-3c3d-11cf-810c-00aa00389b71"); IAccessible root;
    if (AccessibleObjectFromWindow(new IntPtr(hwnd), 0xfffffffc, ref iid, out root) != 0 || root == null) throw new Exception("QQ accessibility unavailable");
    var names=new List<string>(); var buttons=new List<string>(); Walk(root,0,names,buttons);
    return new string[] { String.Join("\n",names), String.Join("\n",buttons) };
  }
  static void Find(IAccessible a, int depth, List<Action> actions) {
    if (a == null || depth > 32 || actions.Count > 1) return;
    try {
      string n=a.get_accName(0); object role=a.get_accRole(0); object state=a.get_accState(0);
      if (n=="接听" && role is int && (int)role==43 && state is int && ((int)state & 1)==0) actions.Add(() => a.accDoDefaultAction(0));
      int count=Math.Min(a.accChildCount,300); if(count<=0)return;
      object[] children=new object[count]; int got; if(AccessibleChildren(a,0,count,children,out got)!=0)return;
      for(int i=0;i<got;i++) {
        IAccessible child=children[i] as IAccessible;
        if(child!=null) Find(child,depth+1,actions);
        else if(children[i] is int) { object id=children[i]; string name=a.get_accName(id); object r=a.get_accRole(id); object s=a.get_accState(id);
          if(name=="接听" && r is int && (int)r==43 && s is int && ((int)s & 1)==0) actions.Add(() => a.accDoDefaultAction(id)); }
      }
    } catch(COMException) { }
  }
  public static bool Accept(long hwnd) {
    Guid iid=new Guid("618736e0-3c3d-11cf-810c-00aa00389b71"); IAccessible root;
    if(AccessibleObjectFromWindow(new IntPtr(hwnd),0xfffffffc,ref iid,out root)!=0 || root==null)return false;
    var actions=new List<Action>(); Find(root,0,actions); if(actions.Count!=1)return false; actions[0](); return true;
  }
}
'@
while ($null -ne ($line = [Console]::ReadLine())) {
  try { $fields=$line.Split(' '); $hwnd=[long]$fields[1]; if($fields[0] -eq 'accept') { @{ok=[QQCallAccess]::Accept($hwnd)} | ConvertTo-Json -Compress } else { $parts=[QQCallAccess]::Read($hwnd); @{buttons=$parts[1]} | ConvertTo-Json -Compress } }
  catch { @{error='accessibility unavailable'} | ConvertTo-Json -Compress }
}
