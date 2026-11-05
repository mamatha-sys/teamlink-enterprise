<#
  TEAMLINK MONITOR - the office-PC agent of HRMS -> Employee Monitoring (2026-11-04).

  What it records, and nothing else:
    * the name of the app in front (chrome, excel ...) and its window title,
    * whether the PC is in use or idle (no mouse / keyboard for the idle minutes HR set),
  and only during work hours (HR sets them; the server throws away anything outside).
  It NEVER records what is typed, passwords, the clipboard, files or screenshots. Chat apps are recorded by name only.

  No hidden mode: the first run shows the company notice, and nothing is recorded until the employee accepts it and signs
  in with their own TeamLink email and password. While it runs, a TeamLink icon sits next to the clock ("Recording PC use
  in work hours"); its menu shows what is recorded and lets the employee stop it.

  Run: double-click TeamLinkMonitorSetup.cmd, downloaded from TeamLink (it holds this script and runs it).
  After set-up it starts with Windows by itself (the icon menu has "Do not start with Windows").
  Settings: %APPDATA%\TeamLinkMonitor\config.json (the device token is encrypted for this Windows user, DPAPI).
#>
param(
  [string]$Server = 'https://teamlink.teamlinks.in'
)
$ErrorActionPreference = 'Stop'
$AgentVersion = '1.4'
# older Windows would otherwise try an old, refused kind of secure connection
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, System.Security
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class TLWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO p);
  [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  public static uint IdleSeconds() {
    LASTINPUTINFO l = new LASTINPUTINFO(); l.cbSize = (uint)Marshal.SizeOf(l);
    if (!GetLastInputInfo(ref l)) return 0;
    return ((uint)Environment.TickCount - l.dwTime) / 1000;
  }
}
'@

# one agent per PC login: running the setup file again must not start a second copy (two icons, every minute counted twice)
$script:OneCopy = New-Object Threading.Mutex($false, 'Local\TeamLinkMonitor')
if (-not $script:OneCopy.WaitOne(0)) {
  [Windows.Forms.MessageBox]::Show('TeamLink Monitor is already running on this PC. Look for its icon next to the clock.', 'TeamLink') | Out-Null
  exit 0
}

$Dir = Join-Path $env:APPDATA 'TeamLinkMonitor'
$ConfigFile = Join-Path $Dir 'config.json'
$QueueFile = Join-Path $Dir 'queue.json'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null

# ---------------------------------------------------------------- starting with Windows (the employee can switch it off in the icon's menu)
$StartupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'TeamLink Monitor.lnk'
function Add-Startup {
  $copy = Join-Path $Dir 'TeamLinkMonitor.ps1'
  if ($PSCommandPath -and ($PSCommandPath -ne $copy)) { Copy-Item -Path $PSCommandPath -Destination $copy -Force }
  $s = (New-Object -ComObject WScript.Shell).CreateShortcut($StartupLink)
  $s.TargetPath = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  $s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$copy`""
  $s.Description = 'TeamLink Monitor: records PC use in work hours (app names, window titles, active and idle time)'
  $s.Save()
}

# ---------------------------------------------------------------- config (token encrypted for this Windows user)
function Save-Config($cfg) {
  $plain = [Text.Encoding]::UTF8.GetBytes($cfg.token)
  $enc = [Security.Cryptography.ProtectedData]::Protect($plain, $null, 'CurrentUser')
  @{ server = $cfg.server; token = [Convert]::ToBase64String($enc); employee = $cfg.employee } | ConvertTo-Json | Set-Content -Path $ConfigFile -Encoding UTF8
}
function Load-Config {
  if (-not (Test-Path $ConfigFile)) { return $null }
  try {
    $raw = Get-Content $ConfigFile -Raw | ConvertFrom-Json
    $dec = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($raw.token), $null, 'CurrentUser')
    return @{ server = $raw.server; token = [Text.Encoding]::UTF8.GetString($dec); employee = $raw.employee }
  } catch { return $null }
}

# ---------------------------------------------------------------- talking to TeamLink
function Call-Api($method, $path, $body, $token) {
  $headers = @{}
  if ($token) { $headers['Authorization'] = "Device $token" }
  # bytes, not a string: Windows PowerShell would send a string in the old Latin encoding and spoil Telugu / Hindi window titles
  # (a typed byte[]: an if-expression would unroll it into a list of numbers)
  [byte[]]$json = $null
  if ($body) { $json = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 6 -Compress)) }
  try {
    $r = Invoke-WebRequest -Method $method -Uri ($script:Server.TrimEnd('/') + '/api/monitoring' + $path) -Headers $headers -Body $json -ContentType 'application/json; charset=utf-8' -UseBasicParsing -TimeoutSec 30
    $text = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
    return @{ status = [int]$r.StatusCode; data = ($text | ConvertFrom-Json) }
  } catch [System.Net.WebException] {
    $resp = $_.Exception.Response
    if ($resp) {
      # Windows PowerShell has already read the answer by now: its text is here, not in the response stream
      $data = $null; try { $data = $_.ErrorDetails.Message | ConvertFrom-Json } catch {}
      return @{ status = [int]$resp.StatusCode; data = $data }
    }
    return @{ status = 0; data = $null }
  } catch { return @{ status = 0; data = $null } }
}

# ---------------------------------------------------------------- the notice and the sign-in (shown, never skipped)
function Show-Notice($text, $version) {
  $f = New-Object Windows.Forms.Form
  $f.Text = "TeamLink - monitoring notice (version $version)"; $f.Width = 620; $f.Height = 480; $f.StartPosition = 'CenterScreen'; $f.TopMost = $true
  $t = New-Object Windows.Forms.TextBox
  $t.Multiline = $true; $t.ReadOnly = $true; $t.ScrollBars = 'Vertical'; $t.Text = ($text -replace "`r?`n", "`r`n"); $t.Dock = 'Top'; $t.Height = 360; $t.Font = New-Object Drawing.Font('Segoe UI', 10)
  $ok = New-Object Windows.Forms.Button; $ok.Text = 'I have read it and I accept'; $ok.Width = 220; $ok.Left = 160; $ok.Top = 380; $ok.DialogResult = 'OK'
  $no = New-Object Windows.Forms.Button; $no.Text = 'I do not accept'; $no.Width = 140; $no.Left = 400; $no.Top = 380; $no.DialogResult = 'Cancel'
  $f.Controls.AddRange(@($t, $ok, $no)); $f.AcceptButton = $ok; $f.CancelButton = $no
  return ($f.ShowDialog() -eq 'OK')
}
$script:lastEmail = ''
function Ask-Login {
  $f = New-Object Windows.Forms.Form
  $f.Text = 'TeamLink - sign in to set up this PC'; $f.Width = 420; $f.Height = 260; $f.StartPosition = 'CenterScreen'; $f.TopMost = $true
  $l1 = New-Object Windows.Forms.Label; $l1.Text = 'Your TeamLink email'; $l1.Left = 20; $l1.Top = 18; $l1.Width = 360
  $e = New-Object Windows.Forms.TextBox; $e.Left = 20; $e.Top = 40; $e.Width = 360; $e.Text = $script:lastEmail
  $l2 = New-Object Windows.Forms.Label; $l2.Text = 'Password'; $l2.Left = 20; $l2.Top = 72; $l2.Width = 360
  $p = New-Object Windows.Forms.TextBox; $p.Left = 20; $p.Top = 94; $p.Width = 360; $p.UseSystemPasswordChar = $true
  $show = New-Object Windows.Forms.CheckBox; $show.Text = 'Show password'; $show.Left = 20; $show.Top = 122; $show.Width = 200
  $show.Add_CheckedChanged({ $p.UseSystemPasswordChar = -not $show.Checked }.GetNewClosure())
  $ok = New-Object Windows.Forms.Button; $ok.Text = 'Set up this PC'; $ok.Left = 20; $ok.Top = 158; $ok.Width = 160; $ok.DialogResult = 'OK'
  $no = New-Object Windows.Forms.Button; $no.Text = 'Cancel'; $no.Left = 200; $no.Top = 158; $no.Width = 100; $no.DialogResult = 'Cancel'
  $f.Controls.AddRange(@($l1, $e, $l2, $p, $show, $ok, $no)); $f.AcceptButton = $ok; $f.CancelButton = $no
  if ($f.ShowDialog() -ne 'OK') { return $null }
  $script:lastEmail = $e.Text.Trim()
  return @{ email = $e.Text.Trim(); password = $p.Text }
}

function Register {
  $os = (Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue).Caption
  $version = $null
  while ($true) {
    $login = Ask-Login
    if (-not $login) { return $null }
    $body = @{ email = $login.email; password = $login.password; deviceName = $env:COMPUTERNAME; os = $os }
    if ($version) { $body.acceptPolicyVersion = $version }
    $r = Call-Api 'POST' '/devices/register' $body $null
    if ($r.status -eq 412 -and $r.data.consentRequired) {
      if (-not (Show-Notice $r.data.policyText $r.data.policyVersion)) { [Windows.Forms.MessageBox]::Show('Nothing was set up and nothing is recorded.', 'TeamLink') | Out-Null; return $null }
      $version = $r.data.policyVersion
      $r = Call-Api 'POST' '/devices/register' (@{ email = $login.email; password = $login.password; deviceName = $env:COMPUTERNAME; os = $os; acceptPolicyVersion = $version }) $null
    }
    if ($r.status -eq 201) {
      $cfg = @{ server = $script:Server; token = $r.data.deviceToken; employee = $r.data.employee }
      Save-Config $cfg
      try { Add-Startup } catch {}
      [Windows.Forms.MessageBox]::Show("This PC is set up for $($r.data.employee). It starts with Windows, and a TeamLink icon next to the clock shows that work hours are recorded. You can stop it from that icon.", 'TeamLink') | Out-Null
      return $cfg
    }
    $msg = if ($r.data -and $r.data.error) { $r.data.error } elseif ($r.status -eq 0) { 'TeamLink could not be reached. Check the internet connection.' } else { "TeamLink said no ($($r.status))." }
    [Windows.Forms.MessageBox]::Show($msg, 'TeamLink') | Out-Null
  }
}

# ---------------------------------------------------------------- start
$cfg = Load-Config
if ($cfg -and $cfg.server) { $script:Server = $cfg.server } else { $script:Server = $Server }
if (-not $cfg) { $cfg = Register; if (-not $cfg) { exit } }

$settings = @{ workStart = '09:30'; workEnd = '18:30'; idleThresholdMinutes = 5 }
$queue = New-Object System.Collections.ArrayList
if (Test-Path $QueueFile) { try { (Get-Content $QueueFile -Raw | ConvertFrom-Json) | ForEach-Object { [void]$queue.Add($_) } } catch {} }
$current = $null      # the open segment: app, title, idle, brk, start
$paused = $false      # stopped by TeamLink (no consent, PC switched off)
$onBreak = $false     # the employee pressed Pause: only the break itself is timed
$clockedOutDay = ''   # the employee clocked out: nothing until the next day

function In-WorkHours {
  $now = (Get-Date).ToUniversalTime().AddMinutes(330).ToString('HH:mm')
  return ($now -ge $settings.workStart -and $now -lt $settings.workEnd)
}
function Close-Segment {
  if ($script:current) {
    $end = (Get-Date).ToUniversalTime()
    if (($end - $script:current.start).TotalSeconds -ge 1) {
      [void]$script:queue.Add(@{ appName = $script:current.app; windowTitle = $script:current.title; start = $script:current.start.ToString('o'); end = $end.ToString('o'); isIdle = $script:current.idle; isBreak = $script:current.brk })
    }
    $script:current = $null
  }
}
function Today-Ist { return (Get-Date).ToUniversalTime().AddMinutes(330).ToString('yyyy-MM-dd') }
function Sample {
  if ($script:clockedOutDay -and $script:clockedOutDay -ne (Today-Ist)) { $script:clockedOutDay = ''; Update-Menu }
  if ($script:paused -or $script:clockedOutDay -or -not (In-WorkHours)) { Close-Segment; return }
  if ($script:onBreak) {
    # a break: only that it is a break and how long; no app, no title
    $c = $script:current
    if ($c -and $c.brk -and ((Get-Date).ToUniversalTime() - $c.start).TotalMinutes -lt 30) { return }
    Close-Segment
    $script:current = @{ app = 'Break'; title = ''; idle = $false; brk = $true; start = (Get-Date).ToUniversalTime() }
    return
  }
  $idle = [TLWin]::IdleSeconds() -ge ([int]$settings.idleThresholdMinutes * 60)
  $h = [TLWin]::GetForegroundWindow()
  $app = 'Desktop'; $title = ''
  if ($h -ne [IntPtr]::Zero) {
    $sb = New-Object Text.StringBuilder 512
    [void][TLWin]::GetWindowText($h, $sb, 512); $title = $sb.ToString()
    $procId = 0; [void][TLWin]::GetWindowThreadProcessId($h, [ref]$procId)
    try { $app = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
  }
  if ($idle) { $title = '' }
  $c = $script:current
  if ($c -and $c.app -eq $app -and $c.title -eq $title -and $c.idle -eq $idle -and ((Get-Date).ToUniversalTime() - $c.start).TotalMinutes -lt 30) { return }
  Close-Segment
  $script:current = @{ app = $app; title = $title; idle = $idle; brk = $false; start = (Get-Date).ToUniversalTime() }
}
function Flush {
  Close-Segment   # send what is done so far; the next sample opens a new segment
  if ($script:queue.Count -eq 0) { return }
  $batch = @($script:queue | Select-Object -First 400)
  $r = Call-Api 'POST' '/activity' @{ records = $batch } $script:cfg.token
  if ($r.status -eq 200) {
    $script:queue.RemoveRange(0, $batch.Count)
  } elseif ($r.status -eq 412) {
    Ask-Consent $r.data
  } elseif ($r.status -eq 401) {
    $script:tray.ShowBalloonTip(8000, 'TeamLink', 'This PC was switched off in TeamLink, or needs to be set up again.', 'Warning')
    $script:paused = $true
  }
  if ($script:queue.Count -gt 5000) { $script:queue.RemoveRange(0, $script:queue.Count - 5000) }
  try { $script:queue | ConvertTo-Json -Depth 4 | Set-Content -Path $QueueFile -Encoding UTF8 } catch {}
}
function Ask-Consent($data) {
  $script:paused = $true
  Close-Segment
  $script:queue.Clear()
  if ($data -and $data.policyText -and (Show-Notice $data.policyText $data.policyVersion)) {
    $r = Call-Api 'POST' '/consent' @{ policyVersion = $data.policyVersion } $script:cfg.token
    if ($r.status -eq 200) { $script:paused = $false }
  }
}
function Heartbeat {
  # what the Live Dashboard shows: the app's name only, never a title
  $c = $script:current
  $state = if ($script:clockedOutDay) { 'clockout' } elseif ($script:onBreak) { 'break' } else { $null }
  $beat = @{ agentVersion = $AgentVersion; paused = $state; currentApp = $(if ($c -and -not $c.brk) { $c.app } else { '' }); idle = [bool]($c -and $c.idle) }
  $r = Call-Api 'POST' '/heartbeat' $beat $script:cfg.token
  if ($r.status -eq 200) {
    $s = $r.data.settings
    $script:settings = @{ workStart = $s.workStart; workEnd = $s.workEnd; idleThresholdMinutes = $s.idleThresholdMinutes }
    # a new notice: shown at once, and nothing more is recorded until it is accepted
    if ($r.data.consentRequired) { Ask-Consent @{ policyText = $r.data.policyText; policyVersion = $s.policyVersion } }
  } elseif ($r.status -eq 401) { $script:paused = $true }
}

# ---------------------------------------------------------------- the icon next to the clock (always visible while it runs)
$tray = New-Object Windows.Forms.NotifyIcon
$tray.Icon = [Drawing.SystemIcons]::Information
$tray.Text = 'TeamLink: recording PC use in work hours'
$tray.Visible = $true
$menu = New-Object Windows.Forms.ContextMenuStrip
$who = $menu.Items.Add("Set up for $($cfg.employee)"); $who.Enabled = $false
[void]$menu.Items.Add('What is recorded (open TeamLink)', $null, { Start-Process ($script:Server.TrimEnd('/') + '/monitoring?tab=mine') })
$pauseItem = $menu.Items.Add('Pause (break)', $null, { $script:onBreak = -not $script:onBreak; Close-Segment; Update-Menu; try { Sample; Heartbeat } catch {} })
$clockItem = $menu.Items.Add('Clock out for today', $null, { $script:onBreak = $false; $script:clockedOutDay = (Today-Ist); Close-Segment; Update-Menu; try { Flush; Heartbeat } catch {} })
function Update-Menu {
  $script:pauseItem.Text = if ($script:onBreak) { 'Resume' } else { 'Pause (break)' }
  $script:pauseItem.Enabled = -not $script:clockedOutDay
  $script:clockItem.Enabled = -not $script:clockedOutDay
  $script:tray.Text = if ($script:clockedOutDay) { 'TeamLink: clocked out for today, nothing is recorded' } elseif ($script:onBreak) { 'TeamLink: on a break, nothing is recorded' } else { 'TeamLink: recording PC use in work hours' }
}
[void]$menu.Items.Add('Stop recording and close', $null, { Flush; $script:tray.Visible = $false; [Windows.Forms.Application]::Exit() })
[void]$menu.Items.Add('Do not start with Windows', $null, { Remove-Item -Path $StartupLink -ErrorAction SilentlyContinue; $script:tray.ShowBalloonTip(5000, 'TeamLink', 'It will not start with Windows any more.', 'Info') })
$tray.ContextMenuStrip = $menu
$tray.ShowBalloonTip(6000, 'TeamLink', 'Recording PC use in work hours: app names, window titles, active and idle time. Nothing you type is recorded.', 'Info')
# the icon above is what shows it is running: the black window goes, so closing it by mistake does not stop the agent
try { [void][TLWin]::ShowWindow([TLWin]::GetConsoleWindow(), 0) } catch {}

Heartbeat
$sampleTimer = New-Object Windows.Forms.Timer; $sampleTimer.Interval = 15000; $sampleTimer.Add_Tick({ try { Sample } catch {} }); $sampleTimer.Start()
$flushTimer = New-Object Windows.Forms.Timer; $flushTimer.Interval = 120000; $flushTimer.Add_Tick({ try { Flush } catch {} }); $flushTimer.Start()
$beatTimer = New-Object Windows.Forms.Timer; $beatTimer.Interval = 60000; $beatTimer.Add_Tick({ try { Heartbeat } catch {} }); $beatTimer.Start()
[Windows.Forms.Application]::Run()
$tray.Dispose()
