[CmdletBinding()]
param(
    [string]$StageRoot = 'C:\DEV\real of trade\asset-staging\s09-logs-export\project-with-shared-materials',
    [switch]$Export,
    [string]$EngineCmd = 'C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
)

$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath('C:\DEV\real of trade')
$root = [IO.Path]::GetFullPath($StageRoot)
$sourceContent = 'C:\Unreal\survival project\SimpleMultiplayerSurvival\Content'
$expected = @(
    @{ Relative = 'Dreamrise_SMSK\Assets\Meshes\SM_Logs.uasset'; Bytes = 23471; Sha256 = '9E5F82F0AC461D38472387A799EC2956520BA7C1F3F91D4F779238203AF234AF' },
    @{ Relative = 'Dreamrise_SMSK\Assets\Materials\MI_Base_Normal.uasset'; Bytes = 8027; Sha256 = '509E551E33A400E102C0038C9FED633179E36C767DF5186D30CC799E5057F189' },
    @{ Relative = 'Dreamrise_SMSK\Assets\Materials\M_Base.uasset'; Bytes = 16009; Sha256 = '5D2B064404166A9F1052CE7FB2055CAAAF0745271430F55101952862A685121F' },
    @{ Relative = 'Dreamrise_SMSK\Assets\Textures\T_ColorPalette.uasset'; Bytes = 25415; Sha256 = 'EA551E2DA7ED2E026A4BDE67A83E6197EF46052462A91BF2A7F4F02F204A1B8D' }
)

function Test-UnderRoot([string]$Path, [string]$Base) {
    $candidate = [IO.Path]::GetFullPath($Path).TrimEnd('\') + '\'
    $basePath = [IO.Path]::GetFullPath($Base).TrimEnd('\') + '\'
    return $candidate.StartsWith($basePath, [StringComparison]::OrdinalIgnoreCase)
}

function Get-ShortPath([string]$Path) {
    if (-not ('S09ShortPath' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class S09ShortPath {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern uint GetShortPathName(string longPath, StringBuilder shortPath, uint capacity);
}
'@
    }
    $buffer = [Text.StringBuilder]::new(32768)
    $length = [S09ShortPath]::GetShortPathName($Path, $buffer, [uint32]$buffer.Capacity)
    if ($length -eq 0 -or $length -ge $buffer.Capacity) { throw "GetShortPathName failed for $Path" }
    $result = $buffer.ToString()
    if ($result.Contains(' ')) { throw "Short path still contains spaces: $result" }
    return $result.Replace('\', '/').ToLowerInvariant()
}

if (-not (Test-UnderRoot $root $workspace) -or $root.TrimEnd('\') -eq $workspace.TrimEnd('\')) { throw "StageRoot must be a child of $workspace" }
if ($root.StartsWith('C:\Unreal', [StringComparison]::OrdinalIgnoreCase) -or $root -match '(?i)\\\.git\\|\\\.claude\\|Program Files\\Epic Games|\\Engine\\') { throw "Refusing unsafe staging path: $root" }
if (-not (Test-Path -LiteralPath $sourceContent -PathType Container)) { throw "Source Content directory not found: $sourceContent" }
if (Test-Path -LiteralPath $root) { throw "Refusing to reuse existing stage directory: $root" }
if (-not (Test-Path -LiteralPath $EngineCmd -PathType Leaf) -and $Export) { throw "UnrealEditor-Cmd not found: $EngineCmd" }

New-Item -ItemType Directory -Path $root | Out-Null
$contentRoot = Join-Path $root 'Content'
$verified = foreach ($item in $expected) {
    $source = Join-Path $sourceContent $item.Relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Required source package is missing: $source" }
    foreach ($suffix in @('.uexp', '.ubulk')) {
        $sidecar = [IO.Path]::ChangeExtension($source, $suffix)
        if (Test-Path -LiteralPath $sidecar) { throw "Unexpected package sidecar; refusing incomplete copy: $sidecar" }
    }
    $file = Get-Item -LiteralPath $source
    $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    if ($file.Length -ne $item.Bytes -or $hash -ne $item.Sha256) { throw "Source package evidence mismatch: $source" }
    $destination = Join-Path $contentRoot $item.Relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $item.Sha256) { throw "Staged package verification failed: $destination" }
    [ordered]@{ source = $source; staged = $destination; bytes = $file.Length; sha256 = $hash }
}

$configRoot = Join-Path $root 'Config'
$toolsRoot = Join-Path $root 'tools'
$cacheRoot = Join-Path $root 'DerivedDataCache'
$outDir = Join-Path $root 'out'
New-Item -ItemType Directory -Path $configRoot, $toolsRoot, $cacheRoot, $outDir -Force | Out-Null
$project = [ordered]@{
    FileVersion = 3
    EngineAssociation = '5.8'
    DisableEnginePluginsByDefault = $true
    Plugins = @(@{ Name = 'PythonScriptPlugin'; Enabled = $true }, @{ Name = 'GLTFExporter'; Enabled = $true })
}
[IO.File]::WriteAllText((Join-Path $root 'S09LogsExport.uproject'), ($project | ConvertTo-Json -Depth 6) + "`n", [Text.UTF8Encoding]::new($false))
$cacheShort = Get-ShortPath $cacheRoot
$ddc = @"
[DerivedDataCacheGraphs]
S09Local=(Local)

[DerivedDataCacheStores]
Local=(Type=FileSystem,Path=$($cacheShort.Replace('/', '\')),PromptIfMissing=false)
"@
[IO.File]::WriteAllText((Join-Path $configRoot 'DefaultEngine.ini'), $ddc, [Text.UTF8Encoding]::new($false))
$autosave = @"
[/Script/UnrealEd.EditorLoadingSavingSettings]
bAutoSaveEnable=False
bAutoSaveMaps=False
bAutoSaveContent=False
"@
[IO.File]::WriteAllText((Join-Path $configRoot 'DefaultEditorPerProjectUserSettings.ini'), $autosave, [Text.UTF8Encoding]::new($false))
$worker = Join-Path $toolsRoot 'export_s09_logs.py'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'export-s09-logs.py') -Destination $worker

$evidence = [ordered]@{
    case = 'S09 isolated Dreamrise SM_Logs geometry export'
    engine = 'UE 5.8'
    engineExecutable = [IO.Path]::GetFullPath($EngineCmd)
    engineFileVersion = if (Test-Path -LiteralPath $EngineCmd -PathType Leaf) { (Get-Item -LiteralPath $EngineCmd).VersionInfo.FileVersion } else { $null }
    project = Join-Path $root 'S09LogsExport.uproject'
    copiedPackages = @($verified)
    sourceAfter = @()
    dependencyClosure = 'SM_Logs -> MI_Base_Normal -> M_Base + T_ColorPalette; NavigationSystem is an Engine package'
    exportRequested = [bool]$Export
    exportOptions = @{ scale = 0.01; lod = 0; bake = 'disabled'; render = 'NullRHI'; shaderCompile = 'disabled' }
    exportExitCode = $null
    outputDirectory = $outDir
    outputs = @()
}

if ($Export) {
    $savedOut = [Environment]::GetEnvironmentVariable('S09_STAGE_OUT', 'Process')
    try {
        $env:S09_STAGE_OUT = [IO.Path]::GetFullPath($outDir)
        $logs = Join-Path $root 'Saved\Logs'
        New-Item -ItemType Directory -Path $logs -Force | Out-Null
        $stdoutPath = Join-Path $logs 'stdout.log'
        $stderrPath = Join-Path $logs 'stderr.log'
        $shortWorker = Get-ShortPath $worker
        $projectArg = [IO.Path]::GetFullPath((Join-Path $root 'S09LogsExport.uproject')).Replace('\', '/')
        $arguments = @(('"' + $projectArg + '"'), '-run=pythonscript', ('-script=' + $shortWorker), '-unattended', '-NoSplash', '-NoSound', '-NoLiveCoding', '-nop4', '-DDC=S09Local', '-stdout', '-FullStdOutLogOutput', '-NullRHI', '-NoShaderCompile')
        $start = [Diagnostics.ProcessStartInfo]::new()
        $start.FileName = $EngineCmd
        $start.Arguments = $arguments -join ' '
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $process = [Diagnostics.Process]::new()
        $process.StartInfo = $start
        if (-not $process.Start()) { throw 'Unreal geometry export failed to start' }
        Write-Host "S09 Unreal geometry export running hidden (PID $($process.Id)); logs: $logs"
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        [IO.File]::WriteAllText($stdoutPath, $stdoutTask.Result, [Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText($stderrPath, $stderrTask.Result, [Text.UTF8Encoding]::new($false))
        $evidence.exportExitCode = $process.ExitCode
        $evidence.stdoutLog = $stdoutPath
        $evidence.stderrLog = $stderrPath
    } finally {
        [Environment]::SetEnvironmentVariable('S09_STAGE_OUT', $savedOut, 'Process')
    }
}

$evidence.sourceAfter = @($verified | ForEach-Object {
    $after = Get-Item -LiteralPath $_.source
    $afterHash = (Get-FileHash -LiteralPath $_.source -Algorithm SHA256).Hash
    if ($after.Length -ne $_.bytes -or $afterHash -ne $_.sha256) { throw "Source package changed during S09: $($_.source)" }
    [ordered]@{ path = $_.source; bytes = $after.Length; sha256 = $afterHash }
})
if ($Export) {
    $evidence.outputs = @(Get-ChildItem -LiteralPath $outDir -File | ForEach-Object { [ordered]@{ path = $_.FullName; bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash } })
}
$evidencePath = Join-Path $root 'evidence.json'
[IO.File]::WriteAllText($evidencePath, ($evidence | ConvertTo-Json -Depth 8) + "`n", [Text.UTF8Encoding]::new($false))
Write-Host "S09 stage created: $root"
Write-Host "Evidence: $evidencePath"
if ($Export -and $evidence.exportExitCode -ne 0) { throw "Unreal export exited with code $($evidence.exportExitCode); inspect $($evidence.stdoutLog)" }
