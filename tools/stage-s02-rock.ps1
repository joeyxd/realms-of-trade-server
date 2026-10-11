[CmdletBinding()]
param(
    [string]$StageRoot = 'C:\DEV\real of trade\asset-staging\s02-rock-export\project',
    [switch]$Export,
    [string]$EngineCmd = 'C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
)

$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath('C:\DEV\real of trade')
$root = [IO.Path]::GetFullPath($StageRoot)
$sourceContent = 'C:\Unreal\survival project\SimpleMultiplayerSurvival\Content'
$expected = @(
    @{ Relative = 'Dreamrise_SMSK\Assets\Meshes\SM_Rock.uasset'; Bytes = 22059; Sha256 = 'FDF2FE0F4F42DB5CF8A23B8DF43758715C8671A89CD8D51BC6A39F2FDCD304AF' },
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
    if (-not ('S02ShortPath' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class S02ShortPath {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern uint GetShortPathName(string longPath, StringBuilder shortPath, uint capacity);
}
'@
    }
    $buffer = [Text.StringBuilder]::new(32768)
    $length = [S02ShortPath]::GetShortPathName($Path, $buffer, [uint32]$buffer.Capacity)
    if ($length -eq 0 -or $length -ge $buffer.Capacity) { throw "GetShortPathName failed for $Path" }
    $result = $buffer.ToString()
    if ($result.Contains(' ')) { throw "Short path still contains spaces: $result" }
    return $result.Replace('\', '/')
}

if (-not (Test-UnderRoot $root $workspace) -or $root.TrimEnd('\') -eq $workspace.TrimEnd('\')) {
    throw "StageRoot must be a child of $workspace"
}
if ($root -match '(?i)\\\.claude\\|\\\.git\\' -or $root.StartsWith('C:\Unreal', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unreal staging path cannot be under .claude, .git, or C:\Unreal: $root"
}
if ($root -match '(?i)Program Files\\Epic Games|\\Engine\\') { throw "Refusing an engine installation path: $root" }
if (-not (Test-Path -LiteralPath $sourceContent -PathType Container)) { throw "Source Content directory not found: $sourceContent" }

$projectFile = Join-Path $root 'S02RockExport.uproject'
$outDir = Join-Path $root 'out'
if (Test-Path -LiteralPath $root) { throw "Refusing to reuse existing stage directory: $root" }

# Verify every source package before creating the stage and retain this exact snapshot for post-export comparison.
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
    [pscustomobject]@{ Source = $source; Relative = $item.Relative; Bytes = $file.Length; Sha256 = $hash }
}

New-Item -ItemType Directory -Path $root | Out-Null
$contentRoot = Join-Path $root 'Content'
foreach ($entry in $verified) {
    $destination = Join-Path $contentRoot $entry.Relative
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Copy-Item -LiteralPath $entry.Source -Destination $destination
    $copied = Get-Item -LiteralPath $destination
    $copyHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    if ($copied.Length -ne $entry.Bytes -or $copyHash -ne $entry.Sha256) { throw "Staged package verification failed: $destination" }
}

$configRoot = Join-Path $root 'Config'
$toolsRoot = Join-Path $root 'tools'
$cacheRoot = Join-Path $root 'DerivedDataCache'
New-Item -ItemType Directory -Path $configRoot, $toolsRoot, $cacheRoot, $outDir -Force | Out-Null
$cacheShort = Get-ShortPath $cacheRoot
$project = [ordered]@{
    FileVersion = 3
    EngineAssociation = '5.8'
    DisableEnginePluginsByDefault = $true
    Plugins = @(
        @{ Name = 'PythonScriptPlugin'; Enabled = $true },
        @{ Name = 'GLTFExporter'; Enabled = $true }
    )
}
[IO.File]::WriteAllText($projectFile, ($project | ConvertTo-Json -Depth 6) + "`n", [Text.UTF8Encoding]::new($false))
$ddc = @"
[DerivedDataCacheGraphs]
S02Local=(Local)

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

$workerSource = Join-Path $PSScriptRoot 'export-s02-rock.py'
if (-not (Test-Path -LiteralPath $workerSource -PathType Leaf)) { throw "S02 export helper is missing: $workerSource" }
$workerPath = Join-Path $toolsRoot 'export_s02_rock.py'
Copy-Item -LiteralPath $workerSource -Destination $workerPath
$copyEvidence = @($verified | ForEach-Object {
    $dest = Join-Path $contentRoot $_.Relative
    [pscustomobject]@{ source = $_.Source; staged = $dest; bytes = $_.Bytes; sha256 = $_.Sha256 }
})
$sourceBefore = @($verified | ForEach-Object {
    [pscustomobject]@{ path = $_.Source; bytes = $_.Bytes; sha256 = $_.Sha256 }
})
$evidence = [ordered]@{
    case = 'S02 isolated SM_Rock geometry export'
    engine = 'UE 5.8'
    engineExecutable = [IO.Path]::GetFullPath($EngineCmd)
    engineFileVersion = if (Test-Path -LiteralPath $EngineCmd -PathType Leaf) { (Get-Item -LiteralPath $EngineCmd).VersionInfo.FileVersion } else { $null }
    project = $projectFile
    sourceContent = $sourceContent
    copiedPackages = $copyEvidence
    sourceHashesBefore = $sourceBefore
    sourceHashesAfter = @()
    derivedDataCache = $cacheRoot
    exportRequested = [bool]$Export
    exportOptions = @{ bakeMode = 'disabled'; render = 'NullRHI'; shaderCompile = 'disabled' }
    exportExitCode = $null
    outputDirectory = $outDir
    outputs = @()
}

if ($Export) {
    if (-not (Test-Path -LiteralPath $EngineCmd -PathType Leaf)) { throw "UnrealEditor-Cmd not found: $EngineCmd" }
    $savedStageOut = [Environment]::GetEnvironmentVariable('S02_STAGE_OUT', 'Process')
    $savedBakeMode = [Environment]::GetEnvironmentVariable('S02_BAKE_MODE', 'Process')
    $hadStageOut = $null -ne $savedStageOut
    $hadBakeMode = $null -ne $savedBakeMode
    try {
        $env:S02_STAGE_OUT = [IO.Path]::GetFullPath($outDir)
        $env:S02_BAKE_MODE = 'disabled'
        $savedLogs = Join-Path $root 'Saved\Logs'
        New-Item -ItemType Directory -Path $savedLogs -Force | Out-Null
        $stdoutPath = Join-Path $savedLogs 'stdout.log'
        $stderrPath = Join-Path $savedLogs 'stderr.log'
        # The commandlet detects the .py suffix case-sensitively; Windows short paths use .PY.
        $shortWorker = (Get-ShortPath $workerPath).ToLowerInvariant()
        $canonicalProjectArg = [IO.Path]::GetFullPath($projectFile).Replace('\', '/')
        $arguments = @(
            ('"' + $canonicalProjectArg + '"'), '-run=pythonscript', ('-script=' + $shortWorker),
            '-unattended', '-NoSplash', '-NoSound', '-NoLiveCoding', '-nop4',
            '-DDC=S02Local', '-stdout', '-FullStdOutLogOutput', '-NullRHI', '-NoShaderCompile'
        )
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
        Write-Host "S02 Unreal geometry export running hidden (PID $($process.Id)); logs: $savedLogs"
        $exportTimer = [Diagnostics.Stopwatch]::StartNew()
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $exportTimer.Stop()
        [IO.File]::WriteAllText($stdoutPath, $stdoutTask.Result, [Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText($stderrPath, $stderrTask.Result, [Text.UTF8Encoding]::new($false))
        $evidence.exportExitCode = $process.ExitCode
        $evidence.exportSeconds = [Math]::Round($exportTimer.Elapsed.TotalSeconds, 2)
        $evidence.stdoutLog = $stdoutPath
        $evidence.stderrLog = $stderrPath
    }
    finally {
        if ($hadStageOut) { [Environment]::SetEnvironmentVariable('S02_STAGE_OUT', $savedStageOut, 'Process') }
        else { [Environment]::SetEnvironmentVariable('S02_STAGE_OUT', $null, 'Process') }
        if ($hadBakeMode) { [Environment]::SetEnvironmentVariable('S02_BAKE_MODE', $savedBakeMode, 'Process') }
        else { [Environment]::SetEnvironmentVariable('S02_BAKE_MODE', $null, 'Process') }
    }
}

$evidence.sourceHashesAfter = @($verified | ForEach-Object {
    $file = Get-Item -LiteralPath $_.Source
    $hash = (Get-FileHash -LiteralPath $_.Source -Algorithm SHA256).Hash
    if ($file.Length -ne $_.Bytes -or $hash -ne $_.Sha256) { throw "Source package changed during S02: $($_.Source)" }
    [pscustomobject]@{ path = $_.Source; bytes = $file.Length; sha256 = $hash }
})
if ($Export) {
    $evidence.outputs = @(Get-ChildItem -LiteralPath $outDir -File | ForEach-Object {
        [pscustomobject]@{ path = $_.FullName; bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    })
}
$evidencePath = Join-Path $root 'evidence.json'
[IO.File]::WriteAllText($evidencePath, ($evidence | ConvertTo-Json -Depth 8) + "`n", [Text.UTF8Encoding]::new($false))
Write-Host "S02 stage created: $root"
Write-Host "Evidence: $evidencePath"
if ($Export -and $evidence.exportExitCode -ne 0) { throw "Unreal export exited with code $($evidence.exportExitCode); inspect $($evidence.stdoutLog)" }
