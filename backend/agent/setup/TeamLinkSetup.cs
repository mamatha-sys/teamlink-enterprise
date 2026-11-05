// TeamLink Monitor setup (.exe). A small, plain unpacker: the server appends the agent to this program (utils/monitoring.js
// agentInstaller); it writes the agent to %APPDATA%\TeamLinkMonitor and starts it. It installs nothing else, needs no admin
// rights, and the agent still shows the notice and the sign-in on the PC.
//   TeamLinkMonitorSetup.exe              set up this PC
//   TeamLinkMonitorSetup.exe /code=XXXX   the set-up code filled in (for IT); the employee still accepts the notice
//   TeamLinkMonitorSetup.exe /extract     only write the agent, for a check
// Build (Windows has the compiler): csc /target:winexe /out:..\TeamLinkMonitorSetup-stub.exe TeamLinkSetup.cs
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("TeamLink Monitor Setup")]
[assembly: AssemblyCompany("TeamLink")]
[assembly: AssemblyProduct("TeamLink Monitor")]
[assembly: AssemblyVersion("1.0.0.0")]

static class TeamLinkSetup {
  // built in two parts, so the only whole marker in the file is the one the server appends
  static readonly string Marker = "::TEAMLINK-" + "PAYLOAD::";

  static int IndexOfLast(byte[] all, byte[] mark) {
    for (int i = all.Length - mark.Length; i >= 0; i--) {
      int j = 0;
      while (j < mark.Length && all[i + j] == mark[j]) j++;
      if (j == mark.Length) return i;
    }
    return -1;
  }

  [STAThread]
  static int Main(string[] args) {
    string code = "";
    bool extract = false;
    foreach (string a in args) {
      if (a.StartsWith("/code=", StringComparison.OrdinalIgnoreCase)) code = a.Substring(6);
      if (string.Equals(a, "/extract", StringComparison.OrdinalIgnoreCase)) extract = true;
    }
    foreach (char c in code) {
      if (!char.IsLetterOrDigit(c) && c != '-') { MessageBox.Show("That set-up code does not look right.", "TeamLink"); return 2; }
    }
    try {
      byte[] all = File.ReadAllBytes(Assembly.GetExecutingAssembly().Location);
      byte[] mark = Encoding.ASCII.GetBytes(Marker);
      int at = IndexOfLast(all, mark);
      if (at < 0) { MessageBox.Show("This setup file is not complete. Download it again from TeamLink.", "TeamLink"); return 3; }
      int start = at + mark.Length;
      string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "TeamLinkMonitor");
      Directory.CreateDirectory(dir);
      string ps1 = Path.Combine(dir, "TeamLinkMonitor.ps1");
      using (FileStream f = new FileStream(ps1, FileMode.Create, FileAccess.Write)) f.Write(all, start, all.Length - start);
      if (extract) return 0;
      ProcessStartInfo p = new ProcessStartInfo();
      p.FileName = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe");
      p.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + ps1 + "\"" + (code.Length > 0 ? " -SetupCode \"" + code + "\"" : "");
      p.UseShellExecute = false;
      p.CreateNoWindow = true;
      Process.Start(p);
      return 0;
    } catch (Exception e) {
      MessageBox.Show("TeamLink Monitor could not start. Please show this to HR or IT.\n\n" + e.Message, "TeamLink");
      return 1;
    }
  }
}
