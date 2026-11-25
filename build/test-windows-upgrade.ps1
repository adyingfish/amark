# Install/uninstall integration test for a disposable GitHub-hosted Windows runner.
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $InstallerPath,
  [Parameter(Mandatory)] [string] $PreviousInstallerPath
)
$ErrorActionPreference = 'Stop'
if ($env:RUNNER_OS -ne 'Windows' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or
    $env:GITHUB_ACTIONS -ne 'true' -or -not [Environment]::Is64BitProcess) {
  throw 'This test installs packages. Run only on a disposable x64 GitHub-hosted Windows runner.'
}
$currentInstaller = (Get-Item -LiteralPath $InstallerPath).FullName
$oldInstaller = (Get-Item -LiteralPath $PreviousInstallerPath).FullName
$currentVersion = (Get-Content -Raw (Join-Path $PSScriptRoot '../package.json') | ConvertFrom-Json).version
$registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey('CurrentUser', 'Registry64')
$uninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\AMark'
$projectKey = 'Software\AMark'
$defaultInstall = Join-Path $env:LOCALAPPDATA 'Programs/AMark'
$testRoot = Join-Path $env:RUNNER_TEMP ('amark-upgrade-' + [guid]::NewGuid().ToString('N'))

function Get-RegistryValue([string] $Key, [string] $Name) {
  $item = $registry.OpenSubKey($Key)
  if ($null -eq $item) { return $null }
  try { return $item.GetValue($Name) } finally { $item.Dispose() }
}
function Assert-Value($Actual, $Expected, [string] $Label) {
  if ($Actual -ne $Expected) { throw "$Label expected '$Expected', got '$Actual'" }
}
function Invoke-Installer([string] $Executable, [string] $Options) {
  $proc = Start-Process -FilePath $Executable -ArgumentList $Options -Wait -PassThru -WindowStyle Hidden
  Assert-Value $proc.ExitCode 0 "Exit code for $Executable"
}
function Assert-CurrentInstall([string] $Directory) {
  Assert-Value (Get-RegistryValue $uninstallKey DisplayVersion) $currentVersion 'Installed version'
  Assert-Value (Get-RegistryValue $projectKey InstallLocation) $Directory 'Installed directory'
  Assert-Value (Test-Path -LiteralPath (Join-Path $Directory 'AMark.exe') -PathType Leaf) $true 'Installed app'
  Assert-Value (Test-Path -LiteralPath (Join-Path $Directory 'resources/app.asar') -PathType Leaf) $true 'Packaged renderer'
  Assert-Value (Test-Path -LiteralPath (Join-Path $Directory 'resources/md.ico') -PathType Leaf) $true 'Markdown icon'
  foreach ($ext in @('md', 'markdown', 'mdown', 'mkd')) {
    Assert-Value (Get-RegistryValue "Software\Classes\.$ext" '') 'AMark.Markdown' "Association .$ext"
  }
  $class = 'Software\Classes\AMark.Markdown'
  Assert-Value (Get-RegistryValue "$class\DefaultIcon" '') "$Directory\resources\md.ico" 'File icon registration'
  Assert-Value (Get-RegistryValue "$class\shell\open\command" '') ('"' + $Directory + '\AMark.exe" "%1"') 'Quoted file open command'
}
function Remove-CurrentInstall([string] $Directory) {
  Assert-CurrentInstall $Directory
  Invoke-Installer (Join-Path $Directory 'Uninstall AMark.exe') '/S /currentuser'
  Assert-Value (Get-RegistryValue $uninstallKey DisplayVersion) $null 'Uninstall registration removed'
  Assert-Value (Test-Path -LiteralPath (Join-Path $Directory 'AMark.exe')) $false 'Executable removed'
}

try {
  Assert-Value (Get-RegistryValue $uninstallKey DisplayVersion) $null 'Clean runner'
  Assert-Value (Test-Path -LiteralPath $defaultInstall) $false 'Unused fresh installation directory'
  Invoke-Installer $currentInstaller '/S /currentuser'
  Remove-CurrentInstall $defaultInstall
  Write-Host 'Fresh installation, four file associations, icon, and uninstall passed.'

  $profile = Join-Path $env:APPDATA 'ai.marswave.amark'
  New-Item -ItemType Directory -Path $profile -Force | Out-Null
  $marker = Join-Path $profile 'upgrade-test-setting'
  Set-Content -LiteralPath $marker -Value 'keep-me'
  foreach ($shared in @($false, $true)) {
    $legacyDirectory = Join-Path $testRoot $(if ($shared) { 'Shared workspace' } else { 'My Markdown Editor' })
    Invoke-Installer $oldInstaller "/S /D=$legacyDirectory"
    Assert-Value (Get-RegistryValue $uninstallKey DisplayVersion) '0.1.1' 'Real Tauri baseline'
    Assert-Value (Get-RegistryValue 'Software\marswave\AMark' '') $legacyDirectory 'Legacy custom directory'
    $note = Join-Path $legacyDirectory 'my-document.md'
    if ($shared) { Set-Content -LiteralPath $note -Value 'keep this document' }
    Invoke-Installer $currentInstaller '/S /currentuser'
    $expected = if ($shared) { Join-Path $legacyDirectory 'AMark Desktop' } else { $legacyDirectory }
    Assert-Value (Test-Path -LiteralPath (Join-Path $legacyDirectory 'uninstall.exe')) $false 'Tauri uninstaller removed'
    Assert-Value (Get-Content -Raw -LiteralPath $marker).Trim() 'keep-me' 'Legacy preferences retained'
    Remove-CurrentInstall $expected
    if ($shared) {
      Assert-Value (Get-Content -Raw -LiteralPath $note).Trim() 'keep this document' 'User document retained after uninstall'
    }
  }
  Write-Host 'Upgrade from Tauri 0.1.1, custom install directory, preferences, and co-located document preservation passed.'
} finally {
  $registry.Dispose()
}
