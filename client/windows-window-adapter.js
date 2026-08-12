const { runSystemCommand } = require('./system-command');
const { isWhitelistedProcess } = require('./process-whitelist');

const WINDOWS_WINDOW_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$Operation = [string]$env:DECKTAP_WINDOW_OPERATION
$WindowId = [string]$env:DECKTAP_WINDOW_ID
$ExpectedProcessId = 0
$ExcludedProcessId = 0
if (-not [int]::TryParse($env:DECKTAP_EXPECTED_PROCESS_ID, [ref]$ExpectedProcessId)) {
  throw 'Invalid expected process identifier.'
}
if (-not [int]::TryParse($env:DECKTAP_EXCLUDED_PROCESS_ID, [ref]$ExcludedProcessId)) {
  throw 'Invalid excluded process identifier.'
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class DeckTapWindowApi {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern int GetWindowTextLengthW(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder className, int maxCount);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@

function Resolve-Handle([string]$Value) {
  $number = 0L
  if (-not [long]::TryParse($Value, [ref]$number) -or $number -le 0) { return [IntPtr]::Zero }
  return [IntPtr]$number
}

function Get-WindowData([IntPtr]$Handle) {
  if ($Handle -eq [IntPtr]::Zero -or -not [DeckTapWindowApi]::IsWindow($Handle)) { return $null }
  $nativeProcessId = [uint32]0
  [void][DeckTapWindowApi]::GetWindowThreadProcessId($Handle, [ref]$nativeProcessId)
  if ($nativeProcessId -le 0) { return $null }

  $length = [DeckTapWindowApi]::GetWindowTextLengthW($Handle)
  $builder = [Text.StringBuilder]::new([Math]::Max(1, $length + 1))
  [void][DeckTapWindowApi]::GetWindowTextW($Handle, $builder, $builder.Capacity)
  $classBuilder = [Text.StringBuilder]::new(256)
  [void][DeckTapWindowApi]::GetClassNameW($Handle, $classBuilder, $classBuilder.Capacity)
  $process = Get-Process -Id $nativeProcessId -ErrorAction SilentlyContinue

  return [ordered]@{
    id = $Handle.ToInt64().ToString()
    processId = [int]$nativeProcessId
    appName = if ($process) { $process.ProcessName } else { 'Unknown application' }
    windowClass = $classBuilder.ToString()
    title = $builder.ToString()
    platform = 'win32'
  }
}

$handle = Resolve-Handle $WindowId

switch ($Operation) {
  'capture' {
    $result = Get-WindowData ([DeckTapWindowApi]::GetForegroundWindow())
  }
  'list' {
    $items = [Collections.Generic.List[object]]::new()
    $callback = [DeckTapWindowApi+EnumWindowsProc]{
      param([IntPtr]$candidate, [IntPtr]$state)
      if ([DeckTapWindowApi]::IsWindowVisible($candidate)) {
        $item = Get-WindowData $candidate
        if ($item -and $item.processId -ne $ExcludedProcessId) { $items.Add($item) }
      }
      return $true
    }
    [void][DeckTapWindowApi]::EnumWindows($callback, [IntPtr]::Zero)
    if ($items.Count -eq 0) {
      Get-Process | ForEach-Object {
        if ($_.Id -ne $ExcludedProcessId) {
          $items.Add([ordered]@{
            id = ([string]$_.Id) + ':process'
            processId = [int]$_.Id
            appName = $_.ProcessName
            windowClass = 'Process'
            title = ''
            platform = 'win32'
          })
        }
      }
    }
    $result = @($items)
  }
  'available' {
    if ($WindowId.EndsWith(':process')) {
      $result = [bool](Get-Process -Id $ExpectedProcessId -ErrorAction SilentlyContinue)
      break
    }
    $item = Get-WindowData $handle
    $result = [bool]($item -and ($ExpectedProcessId -le 0 -or $item.processId -eq $ExpectedProcessId))
  }
  'activate' {
    if ($WindowId.EndsWith(':process')) {
      $process = Get-Process -Id $ExpectedProcessId -ErrorAction SilentlyContinue
      $mainWindow = if ($process) { $process.MainWindowHandle } else { [IntPtr]::Zero }
      if ($mainWindow -eq [IntPtr]::Zero) {
        $result = $false
        break
      }
      if ([DeckTapWindowApi]::IsIconic($mainWindow)) { [void][DeckTapWindowApi]::ShowWindowAsync($mainWindow, 9) }
      [void][DeckTapWindowApi]::BringWindowToTop($mainWindow)
      [void][DeckTapWindowApi]::SetForegroundWindow($mainWindow)
      Start-Sleep -Milliseconds 80
      $result = [DeckTapWindowApi]::GetForegroundWindow() -eq $mainWindow
      break
    }
    $item = Get-WindowData $handle
    if (-not $item -or ($ExpectedProcessId -gt 0 -and $item.processId -ne $ExpectedProcessId)) {
      $result = $false
      break
    }
    if ([DeckTapWindowApi]::IsIconic($handle)) { [void][DeckTapWindowApi]::ShowWindowAsync($handle, 9) }
    [void][DeckTapWindowApi]::BringWindowToTop($handle)
    [void][DeckTapWindowApi]::SetForegroundWindow($handle)
    Start-Sleep -Milliseconds 80
    $result = [DeckTapWindowApi]::GetForegroundWindow() -eq $handle
  }
  'active' {
    if ($WindowId.EndsWith(':process')) {
      $process = Get-Process -Id $ExpectedProcessId -ErrorAction SilentlyContinue
      $mainWindow = if ($process) { $process.MainWindowHandle } else { [IntPtr]::Zero }
      $result = $mainWindow -ne [IntPtr]::Zero -and [DeckTapWindowApi]::GetForegroundWindow() -eq $mainWindow
      break
    }
    $result = [DeckTapWindowApi]::GetForegroundWindow() -eq $handle
  }
  default { throw 'Unsupported window operation.' }
}

ConvertTo-Json -Compress -InputObject $result
`;

const WINDOWS_WINDOW_SCRIPT_BASE64 = Buffer.from(WINDOWS_WINDOW_SCRIPT, 'utf16le').toString('base64');

function createWindowsCommand(operation, target = {}, options = {}) {
  return {
    executable: options.executable || 'powershell.exe',
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      WINDOWS_WINDOW_SCRIPT_BASE64,
    ],
    env: {
      ...process.env,
      ...(options.env || {}),
      DECKTAP_WINDOW_OPERATION: operation,
      DECKTAP_WINDOW_ID: String(target.id || ''),
      DECKTAP_EXPECTED_PROCESS_ID: String(target.processId || 0),
      DECKTAP_EXCLUDED_PROCESS_ID: String(options.excludeProcessId || process.pid),
    },
  };
}

function sanitizeWindow(value) {
  if (!value || typeof value !== 'object') return null;
  const processId = Number(value.processId);
  const id = String(value.id || '');
  if (!id || !Number.isSafeInteger(processId) || processId <= 0) return null;
  return Object.freeze({
    id: id.slice(0, 128),
    processId,
    appName: String(value.appName || 'Unknown application').slice(0, 160),
    windowClass: String(value.windowClass || '').slice(0, 160),
    title: String(value.title || '').slice(0, 512),
    platform: 'win32',
  });
}

function filterFallbackProcesses(windows) {
  return windows.filter((window) => (
    !String(window.id || '').endsWith(':process')
    || isWhitelistedProcess(window.appName, 'win32')
  ));
}

function createWindowsWindowAdapter(options = {}) {
  const run = options.run || ((operation, target = {}) => {
    const command = createWindowsCommand(operation, target, options);
    return runSystemCommand(command.executable, command.args, { ...options, env: command.env });
  });

  return {
    async captureActiveWindow() {
      return sanitizeWindow(await run('capture'));
    },
    async listWindows() {
      const result = await run('list');
      return filterFallbackProcesses((Array.isArray(result) ? result : [result]).map(sanitizeWindow).filter(Boolean));
    },
    async isWindowAvailable(target) {
      return (await run('available', target)) === true;
    },
    async activateWindow(target) {
      return (await run('activate', target)) === true;
    },
    async isWindowActive(target) {
      return (await run('active', target)) === true;
    },
  };
}

module.exports = {
  WINDOWS_WINDOW_SCRIPT,
  WINDOWS_WINDOW_SCRIPT_BASE64,
  createWindowsCommand,
  createWindowsWindowAdapter,
  filterFallbackProcesses,
  sanitizeWindow,
};
