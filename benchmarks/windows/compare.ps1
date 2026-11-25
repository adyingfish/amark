# Run both released applications on one private copy of the supplied Markdown directory.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$TauriExe,
    [Parameter(Mandatory)][string]$ElectronExe,
    [Parameter(Mandatory)][string]$Workspace,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [ValidateRange(1,1440)][int]$Minutes = 60,
    [ValidateRange(5,300)][int]$IntervalSeconds = 30
)
$ErrorActionPreference = 'Stop'
$tauriPath = (Resolve-Path -LiteralPath $TauriExe).ProviderPath
$electronPath = (Resolve-Path -LiteralPath $ElectronExe).ProviderPath
$source = (Resolve-Path -LiteralPath $Workspace).ProviderPath
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Choose a new output directory' }
$output = (New-Item -ItemType Directory -Path $OutputDirectory).FullName
$copy = (New-Item -ItemType Directory -Path (Join-Path $output 'workspace')).FullName
$documents = @(Get-ChildItem -LiteralPath $source -File -Filter '*.md' | Sort-Object Name)
if ($documents.Count -lt 4 -or 'soak-active.md' -in $documents.Name) { throw 'Provide at least four Markdown files and reserve soak-active.md' }
foreach ($doc in $documents) { Copy-Item -LiteralPath $doc.FullName -Destination $copy }
$content = Get-Content -Raw -Encoding utf8 -LiteralPath ($documents | Sort-Object Length -Descending | Select-Object -First 1).FullName
$active = Join-Path $copy 'soak-active.md'
function Write-Revision([int]$Revision) {
    [IO.File]::WriteAllText($active, "$content`n`nAMARK-SOAK-$Revision`n", [Text.UTF8Encoding]::new($false))
}
Write-Revision 0
$apps = [ordered]@{}
$ports = @{}
function Get-FreePort {
    $socket = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $socket.Start()
    try { return $socket.LocalEndpoint.Port } finally { $socket.Stop() }
}
function Check-Window($Engine, $Action, $ArgValue) {
    $result = & node (Join-Path $PSScriptRoot 'observe.mjs') $ports[$Engine] $Action $ArgValue
    if ($LASTEXITCODE -ne 0) { throw "$Engine failed UI check $Action" }
    return ($result | ConvertFrom-Json)
}
function Measure-Trees {
    $procs = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name)
    $idsByEngine = @{}
    foreach ($engine in $apps.Keys) {
        if ($apps[$engine].HasExited) { throw "$engine exited" }
        $ids = [Collections.Generic.HashSet[int]]::new()
        [void]$ids.Add($apps[$engine].Id)
        do {
            $count = $ids.Count
            foreach ($p in $procs) { if ($ids.Contains([int]$p.ParentProcessId)) { [void]$ids.Add([int]$p.ProcessId) } }
        } while ($count -ne $ids.Count)
        if ($ids.Count -lt 3) { throw "Incomplete $engine process tree" }
        $idsByEngine[$engine] = $ids
    }
    $filter = (($idsByEngine.Values | ForEach-Object { $_ } | Sort-Object -Unique) | ForEach-Object {"IDProcess = $_"}) -join ' OR '
    $counters = @(Get-CimInstance Win32_PerfRawData_PerfProc_Process -Filter $filter)
    $readings = @{}
    foreach ($engine in $apps.Keys) {
        $ids = $idsByEngine[$engine]
        $rows = @($counters | Where-Object { $ids.Contains([int]$_.IDProcess) })
        if ($rows.Count -ne $ids.Count) { throw "Performance counters missing for $engine" }
        $readings[$engine] = [ordered]@{
            processes = $rows.Count
            workingSetMiB = [math]::Round(($rows | Measure-Object WorkingSetPrivate -Sum).Sum / 1MB, 2)
            commitMiB = [math]::Round(($rows | Measure-Object PrivateBytes -Sum).Sum / 1MB, 2)
            handles = ($rows | Measure-Object HandleCount -Sum).Sum
        }
    }
    return $readings
}
try {
    foreach ($engine in @('Tauri','Electron')) {
        $port = Get-FreePort
        $ports[$engine] = $port
        $profile = (New-Item -ItemType Directory -Path (Join-Path $output "$engine-profile")).FullName
        $flags = @("--remote-debugging-port=$port",'--remote-debugging-address=127.0.0.1','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding')
        if ($engine -eq 'Tauri') {
            $env:WEBVIEW2_USER_DATA_FOLDER = $profile
            $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $flags -join ' '
            $apps[$engine] = Start-Process -FilePath $tauriPath -ArgumentList @('"' + $active + '"') -WorkingDirectory $output -PassThru -WindowStyle Hidden
        } else {
            $argsList = $flags + @(('--user-data-dir="' + $profile + '"'), ('"' + $active + '"'))
            $apps[$engine] = Start-Process -FilePath $electronPath -ArgumentList $argsList -WorkingDirectory $output -PassThru -WindowStyle Hidden
        }
        $v = Check-Window $engine maximize 0
        Write-Output "$engine maximized: $($v.width)x$($v.height)"
        if ($engine -eq 'Tauri') { $targetViewport=$v }
        elseif ([math]::Abs($v.width-$targetViewport.width) -gt 2 -or [math]::Abs($v.height-$targetViewport.height) -gt 2) { throw 'Physical window sizes do not match' }
        $ui = Check-Window $engine init ($documents.Count + 1)
        Write-Output "$engine ready: $($ui.rows) files, $($ui.tabs) tabs, viewport $($ui.width)x$($ui.height)"
    }
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $totalSeconds = $Minutes * 60
    $file = Join-Path $output 'samples.csv'
    $startedAt=[DateTimeOffset]::UtcNow.ToString("o")
    $revision = 0
    $released = $false
    $nextActivity = 0
    $nextSample = 0
    $lastUi = @{}
    while ($true) {
        $age = $timer.Elapsed.TotalSeconds
        $phase = if ($age -lt $totalSeconds/12) { 'warm' } elseif ($age -lt $totalSeconds*0.75) { 'writes' } else { 'settled' }
        if ($phase -eq 'writes' -and $age -ge $nextActivity) {
            Write-Revision (++$revision)
            $nextActivity = $age + 10
        }
        if ($phase -eq 'settled' -and !$released) {
            foreach ($engine in $apps.Keys) { $null = Check-Window $engine release 0 }
            $released = $true
        }
        if ($age -ge $nextSample -or $age -ge $totalSeconds) {
            foreach ($engine in $apps.Keys) { $lastUi[$engine] = Check-Window $engine verify $revision }
            for ($attempt=1; $attempt -le 3; $attempt++) {
                try { $stats = Measure-Trees; break }
                catch {
                    if ($attempt -eq 3) { throw }
                    Start-Sleep -Milliseconds 250
                }
            }
            foreach ($engine in $apps.Keys) {
                if ([math]::Abs($lastUi[$engine].width-$targetViewport.width) -gt 2 -or [math]::Abs($lastUi[$engine].height-$targetViewport.height) -gt 2) { throw "$engine viewport changed" }
                $m = $stats[$engine]
                $ui = $lastUi[$engine]
                [pscustomobject]@{ engine=$engine; seconds=[math]::Round($timer.Elapsed.TotalSeconds,1); phase=$phase; revision=$revision; tabs=$ui.tabs; viewport="$($ui.width)x$($ui.height)"; visible=$ui.visible; processes=$m.processes; workingSetMiB=$m.workingSetMiB; commitMiB=$m.commitMiB; handles=$m.handles } | Export-Csv -LiteralPath $file -Append -NoTypeInformation
            }
            $nextSample += $IntervalSeconds
        }
        if ($age -ge $totalSeconds) { break }
        Start-Sleep -Milliseconds 300
    }
    $electronResources = Join-Path (Split-Path -Parent $electronPath) 'resources/app.asar'
    [ordered]@{ startedUtc=$startedAt; system=[Environment]::OSVersion.VersionString; minutes=$Minutes; intervalSeconds=$IntervalSeconds; tauriUserAgent=$lastUi['Tauri'].agent; electronUserAgent=$lastUi['Electron'].agent; asarSha256=(Get-FileHash -LiteralPath $electronResources).Hash; durationSeconds=[math]::Round($timer.Elapsed.TotalSeconds,1); originals=$documents.Count; sourceBytes=($documents | Measure-Object Length -Sum).Sum; revisions=$revision; sharedWorkspace=$true; tauriSha256=(Get-FileHash $tauriPath).Hash; electronSha256=(Get-FileHash $electronPath).Hash } | ConvertTo-Json | Set-Content -Encoding utf8NoBOM -LiteralPath (Join-Path $output 'run.json')
    Write-Output "Completed: $file"
} finally {
    foreach ($p in $apps.Values) {
        if (!$p.HasExited) { [void]$p.CloseMainWindow(); if (!$p.WaitForExit(4000)) { $p.Kill($true) } }
    }
}
