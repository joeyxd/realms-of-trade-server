[CmdletBinding()]
param(
    [string]$StageRoot = 'C:\DEV\real of trade\asset-workshop-preparation',
    [switch]$Export,
    [string]$EngineCmd = 'C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
)

$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath('C:\DEV\real of trade')
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$stage = [IO.Path]::GetFullPath($StageRoot)
$gameContent = 'C:\Unreal\survival project\SimpleMultiplayerSurvival\Content'
$registrySource = 'C:\Unreal\survival project\SimpleMultiplayerSurvival\Intermediate'
$fabRoot = 'C:\ProgramData\Epic\EpicGamesLauncher\VaultCache\FabLibrary\FANTASTIC_-_Village_Pack-52529a12\fbx\fbx_and_textures_fantast_extracted'
$sourceDefinitions = @(
    @{ id='aw-pilot-01'; package='AdvancedVillagePack/Meshes/SM_Cauldron.uasset'; path=(Join-Path $gameContent 'AdvancedVillagePack\Meshes\SM_Cauldron.uasset'); kind='static-mesh'; variants=@(@{ id='default'; label='Nuevo' }) },
    @{ id='aw-pilot-02'; package='RPGEnvironmentVFX/Essentials/Mesh/Mesh/SM_DemoCauldron.uasset'; path=(Join-Path $gameContent 'RPGEnvironmentVFX\Essentials\Mesh\Mesh\SM_DemoCauldron.uasset'); kind='static-mesh'; variants=@(@{ id='default'; label='Anterior' }) },
    @{ id='aw-pilot-03'; package='UltimateFarming/Meshes/SM_Cotton_A.uasset'; path=(Join-Path $gameContent 'UltimateFarming\Meshes\SM_Cotton_A.uasset'); kind='static-mesh'; variants=@(@{ id='intact'; label='Intacto'; package='UltimateFarming/Meshes/SM_Cotton_A.uasset' },@{ id='harvested'; label='Cosechado'; package='UltimateFarming/Meshes/SM_Cotton_A_Harvested.uasset' }) },
    @{ id='aw-pilot-03'; package='UltimateFarming/Meshes/SM_Cotton_A_Harvested.uasset'; path=(Join-Path $gameContent 'UltimateFarming\Meshes\SM_Cotton_A_Harvested.uasset'); kind='static-mesh'; variants=@() },
    @{ id='aw-pilot-04'; package='PN_Banana/Meshes/plants/banana_01_01.uasset'; path=(Join-Path $gameContent 'PN_Banana\Meshes\plants\banana_01_01.uasset'); kind='static-mesh'; variants=@(@{ id='default'; label='Default' }) },
    @{ id='aw-pilot-05'; package='Kobo_Nature/Meshes/SM-Palm/SM-Palm-01.uasset'; path=(Join-Path $gameContent 'Kobo_Nature\Meshes\SM-Palm\SM-Palm-01.uasset'); kind='static-mesh'; variants=@(@{ id='default'; label='Default' }) },
    @{ id='aw-pilot-06'; package='Greek_island/Assets/Houses/SM_door_01.uasset'; path=(Join-Path $gameContent 'Greek_island\Assets\Houses\SM_door_01.uasset'); kind='static-mesh'; variants=@(@{ id='default'; label='Default' }) },
    @{ id='aw-pilot-07'; package='Greek_island/Assets/Boat/SM_Boat_01.uasset'; path=(Join-Path $gameContent 'Greek_island\Assets\Boat\SM_Boat_01.uasset'); kind='static-mesh'; variants=@(@{ id='default'; label='Default' }) },
    @{ id='aw-pilot-08'; package='Bazaar_Meshingun/Environment/Assets/Material/Tileable/MI_Trimsheet_Wood_01a.uasset'; path=(Join-Path $gameContent 'Bazaar_Meshingun\Environment\Assets\Material\Tileable\MI_Trimsheet_Wood_01a.uasset'); kind='material'; variants=@(@{ id='default'; label='Default' }) },
    @{ id='aw-pilot-09'; package='Bazaar_Meshingun/Environment/Assets/Material/Prop/MI_Metalware_01a.uasset'; path=(Join-Path $gameContent 'Bazaar_Meshingun\Environment\Assets\Material\Prop\MI_Metalware_01a.uasset'); kind='material'; variants=@(@{ id='default'; label='Default' }) },
    @{ id='aw-pilot-10'; package='UltimateFarming/Materials/MasterMaterials/M_Glass.uasset'; path=(Join-Path $gameContent 'UltimateFarming\Materials\MasterMaterials\M_Glass.uasset'); kind='material'; variants=@(@{ id='default'; label='Default' }) },
    @{ id='aw-pilot-11'; package='FANTASTIC_-_Village_Pack-52529a12/fbx/fbx_and_textures_fantast_extracted/2d/textures/T_leather.png'; path=(Join-Path $fabRoot '2d\textures\T_leather.png'); kind='texture'; variants=@(@{ id='default'; label='Default' }) },
    @{ id='aw-pilot-12'; package='FANTASTIC_-_Village_Pack-52529a12/fbx/fbx_and_textures_fantast_extracted/3d/buildings/SM_BLD_balcony_v01_01.fbx'; path=(Join-Path $fabRoot '3d\buildings\SM_BLD_balcony_v01_01.fbx'); kind='static-mesh'; variants=@(@{ id='default'; label='Default' }) },
    @{ id='aw-pilot-19'; package='CraftResourcesIcons/Textures/Tex_leather_01.png'; path=(Join-Path $gameContent 'CraftResourcesIcons\Textures\Tex_leather_01.png'); kind='icon'; variants=@(@{ id='default'; label='Default' }) }
)

function Test-UnderRoot([string]$Path, [string]$Base) {
    $candidate = [IO.Path]::GetFullPath($Path).TrimEnd('\') + '\'
    $basePath = [IO.Path]::GetFullPath($Base).TrimEnd('\') + '\'
    return $candidate.StartsWith($basePath, [StringComparison]::OrdinalIgnoreCase)
}
function Get-HashRecord([string]$Path, [string]$Role) {
    $item = Get-Item -LiteralPath $Path
    [pscustomobject]@{ path=$Path; role=$Role; bytes=$item.Length; sha256=(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
}
function Get-StringSha256([string]$Value) {
    $hasher=[Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-','').ToLowerInvariant() }
    finally { $hasher.Dispose() }
}
function Get-ShortPath([string]$Path) {
    if (-not ('AW01ShortPath' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class AW01ShortPath {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern uint GetShortPathName(string longPath, StringBuilder shortPath, uint capacity);
}
'@
    }
    $buffer=[Text.StringBuilder]::new(32768)
    $length=[AW01ShortPath]::GetShortPathName($Path,$buffer,[uint32]$buffer.Capacity)
    if ($length -eq 0 -or $length -ge $buffer.Capacity) { throw "GetShortPathName failed: $Path" }
    return $buffer.ToString().Replace('\','/')
}
function Write-MobilePng([string]$Source,[string]$Destination) {
    [void][Reflection.Assembly]::LoadWithPartialName('System.Drawing')
    $image=[Drawing.Image]::FromFile($Source)
    try {
        if ($image.Width -le 512 -and $image.Height -le 512) {
            $image.Dispose()
            Copy-Item -LiteralPath $Source -Destination $Destination -Force
            return
        }
        $factor=[Math]::Min(1.0,512.0/[Math]::Max($image.Width,$image.Height))
        $width=[Math]::Max(1,[int][Math]::Round($image.Width*$factor))
        $height=[Math]::Max(1,[int][Math]::Round($image.Height*$factor))
        $bitmap=[Drawing.Bitmap]::new($width,$height)
        try {
            $graphics=[Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.CompositingQuality=[Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.DrawImage($image,0,0,$width,$height)
            } finally { $graphics.Dispose() }
            $bitmap.Save($Destination,[Drawing.Imaging.ImageFormat]::Png)
        } finally { $bitmap.Dispose() }
    } finally { $image.Dispose() }
}

if (-not (Test-UnderRoot $stage $workspace) -or $stage.TrimEnd('\') -eq $workspace.TrimEnd('\') -or $stage.TrimEnd('\') -eq $repoRoot.TrimEnd('\')) { throw "StageRoot must be a dedicated child of C:\DEV\real of trade: $stage" }
if ($stage -match '(?i)\\\.git\\|\\\.claude\\|\\Engine\\|Program Files\\Epic Games' -or $stage.StartsWith('C:\Unreal',[StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe stage path: $stage" }
if (-not (Test-Path -LiteralPath $gameContent -PathType Container)) { throw "Original project Content missing: $gameContent" }

$sources = @()
foreach ($definition in $sourceDefinitions) {
    if (-not (Test-Path -LiteralPath $definition.path -PathType Leaf)) { throw "Candidate source missing: $($definition.path)" }
    $sources += Get-HashRecord $definition.path 'candidate'
    foreach ($suffix in @('.uexp','.ubulk')) {
        $sidecar = [IO.Path]::ChangeExtension($definition.path,$suffix)
        if (Test-Path -LiteralPath $sidecar -PathType Leaf) { $sources += Get-HashRecord $sidecar 'candidate-sidecar' }
    }
}
$registryRef=Join-Path $registrySource 'CachedAssetRegistry\CachedAssetRegistry_0.ref'
if (-not (Test-Path -LiteralPath $registryRef -PathType Leaf)) { throw "Source Asset Registry reference missing: $registryRef" }
$registryName=(Get-Content -LiteralPath $registryRef -Raw).Trim()
$registryFiles=@(
    @{path=$registryRef;relative='CachedAssetRegistry\CachedAssetRegistry_0.ref'},
    @{path=(Join-Path (Split-Path $registryRef -Parent) $registryName);relative=('CachedAssetRegistry\'+$registryName)},
    @{path=(Join-Path $registrySource 'CachedAssetRegistryDiscovery.bin');relative='CachedAssetRegistryDiscovery.bin'}
)
foreach ($registryFile in $registryFiles) {
    if (-not (Test-Path -LiteralPath $registryFile.path -PathType Leaf)) { throw "Source Asset Registry cache input missing: $($registryFile.path)" }
    $sources += Get-HashRecord $registryFile.path 'registry-cache'
}
$recipeInputs = @((Join-Path $PSScriptRoot 'prepare-aw01.ps1'),(Join-Path $PSScriptRoot 'ue-aw01.py'),(Join-Path $PSScriptRoot 'prepare-aw01-finalize.py'),(Join-Path $PSScriptRoot 'prepare-aw01-verify.py'))
$recipeMaterial = ($recipeInputs | ForEach-Object { (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant() }) -join "`n"
$recipeSha256 = Get-StringSha256 $recipeMaterial

$contentStage = Join-Path $stage 'Content'
$outDir = Join-Path $repoRoot 'assets\workshop'
New-Item -ItemType Directory -Path $stage,$contentStage,$outDir,(Join-Path $stage 'Intermediate\CachedAssetRegistry') -Force | Out-Null
$copyRecords = @()
foreach ($definition in $sourceDefinitions) {
    $relative = if ($definition.kind -in @('texture','icon')) {
        'AW01Imports\' + [IO.Path]::GetFileName($definition.path)
    } elseif ($definition.path.StartsWith($gameContent,[StringComparison]::OrdinalIgnoreCase)) {
        $definition.path.Substring($gameContent.Length).TrimStart('\')
    } else { 'AW01Imports\' + [IO.Path]::GetFileName($definition.path) }
    $destination = Join-Path $contentStage $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    if (Test-Path -LiteralPath $destination) {
        if ((Get-FileHash -LiteralPath $definition.path -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash) { throw "Existing staged package does not match source: $destination" }
    } else { Copy-Item -LiteralPath $definition.path -Destination $destination }
    $sourceHash = (Get-FileHash -LiteralPath $definition.path -Algorithm SHA256).Hash
    $copyHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    if ($sourceHash -ne $copyHash) { throw "Copy hash mismatch: $($definition.path)" }
    $copyRecords += [pscustomobject]@{source=$definition.path; staged=$destination; package=$definition.package; bytes=(Get-Item $destination).Length; sha256=$copyHash.ToLowerInvariant(); id=$definition.id}
    foreach ($suffix in @('.uexp','.ubulk')) {
        $sidecarSource=[IO.Path]::ChangeExtension($definition.path,$suffix)
        if (Test-Path -LiteralPath $sidecarSource -PathType Leaf) {
            $sidecarStage=[IO.Path]::ChangeExtension($destination,$suffix)
            if (-not (Test-Path -LiteralPath $sidecarStage)) { Copy-Item -LiteralPath $sidecarSource -Destination $sidecarStage }
            $sidecarRecord=Get-HashRecord $sidecarSource 'candidate-sidecar'
            if ((Get-FileHash -LiteralPath $sidecarStage -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sidecarRecord.sha256) { throw "Sidecar hash mismatch: $sidecarStage" }
            $copyRecords += [pscustomobject]@{source=$sidecarSource;staged=$sidecarStage;package=$definition.package+ $suffix;bytes=$sidecarRecord.bytes;sha256=$sidecarRecord.sha256;id=$definition.id}
        }
    }
}
foreach ($registryFile in $registryFiles) {
    $destination=Join-Path (Join-Path $stage 'Intermediate') $registryFile.relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $registryFile.path -Destination $destination -Force
    $sourceRecord=Get-HashRecord $registryFile.path 'registry-cache'
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sourceRecord.sha256) { throw "Asset Registry cache copy mismatch: $destination" }
    $copyRecords += [pscustomobject]@{source=$registryFile.path;staged=$destination;package='asset-registry-cache';bytes=$sourceRecord.bytes;sha256=$sourceRecord.sha256;id='_asset-registry'}
}
foreach ($definition in $sourceDefinitions | Where-Object { $_.kind -in @('texture','icon') }) {
    $filename=[IO.Path]::GetFileName($definition.path)
    $stagedSource=Join-Path $contentStage ('AW01Imports\'+$filename)
    $artifactDir=Join-Path $outDir $definition.id
    New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null
    Write-MobilePng $stagedSource (Join-Path $artifactDir 'mobile.png')
}

$projectFile = Join-Path $stage 'AW01Preparation.uproject'
$config = Join-Path $stage 'Config'
$toolsDir = Join-Path $stage 'tools'
$logsDir = Join-Path $stage 'Saved\Logs'
New-Item -ItemType Directory -Path $config,$toolsDir,$logsDir -Force | Out-Null
$project = [ordered]@{ FileVersion=3; EngineAssociation='5.8'; DisableEnginePluginsByDefault=$true; Plugins=@(@{Name='PythonScriptPlugin';Enabled=$true},@{Name='GLTFExporter';Enabled=$true}) }
[IO.File]::WriteAllText($projectFile,($project|ConvertTo-Json -Depth 5)+"`n",[Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ue-aw01.py') -Destination (Join-Path $toolsDir 'ue-aw01.py')

$prepared = [ordered]@{
    schema='marea.asset-prepared.v1'
    revision='aw01-preparation-v1'
    recipeSha256=$recipeSha256
    generatedAtUtc=[DateTime]::UtcNow.ToString('o')
    stage=$stage
    engine='UE 5.8'
    sources=$sources
    copies=$copyRecords
    sourceHashesAfter=@()
    commandlet=@{requested=[bool]$Export; exitCode=$null; stdout=$null; stderr=$null}
    entries=@()
}

if ($Export) {
    $reuse=$false
    $existingManifest=Join-Path $outDir 'prepared.json'
    $receiptPath=Join-Path $repoRoot 'docs\delivery\asset-workshop\preparation-receipt.json'
    if (Test-Path -LiteralPath $existingManifest -PathType Leaf) {
        try {
            $old=Get-Content -LiteralPath $existingManifest -Raw | ConvertFrom-Json
            $receipt=Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
            if ($receipt.recipeSha256 -eq $recipeSha256 -and $receipt.sources.Count -gt 0 -and $old.entries.Count -gt 0) {
                $sameSources=$true
                foreach ($before in $receipt.sources) {
                    if (-not (Test-Path -LiteralPath $before.source -PathType Leaf)) { $sameSources=$false; break }
                    $now=Get-HashRecord $before.source 'verify'
                    if ($now.sha256 -ne $before.sha256 -or $now.bytes -ne $before.bytes -or -not (Test-Path -LiteralPath $before.staged -PathType Leaf)) { $sameSources=$false; break }
                    if ((Get-FileHash -LiteralPath $before.staged -Algorithm SHA256).Hash.ToLowerInvariant() -ne $before.sha256) { $sameSources=$false; break }
                }
                $allOutputs=$true
                foreach ($asset in $old.entries) {
                    $previewNodes=@()
                    if ($asset.preview) { $previewNodes += $asset.preview }
                    foreach ($variant in $asset.variants) { if ($variant.preview) { $previewNodes += $variant.preview } }
                    foreach ($preview in $previewNodes) {
                        foreach ($density in @('desktop','mobile')) {
                            $item=$preview.$density
                            if (-not $item) { $allOutputs=$false; continue }
                            $absolute=Join-Path $repoRoot ($item.url.Replace('/','\'))
                            if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) { $allOutputs=$false; continue }
                            if ((Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256) { $allOutputs=$false }
                        }
                    }
                }
                if ($sameSources -and $allOutputs) { $prepared.entries=$old.entries; $reuse=$true; Write-Host 'AW01 outputs match recipe, source closure, and output hashes; reusing verified artifacts.' }
            }
        } catch { Write-Host "AW01 reuse check failed; preparing outputs again: $($_.Exception.Message)" }
    }
    if (-not $reuse) {
    if (-not (Test-Path -LiteralPath $EngineCmd -PathType Leaf)) { throw "UnrealEditor-Cmd missing: $EngineCmd" }
    $manifest = [ordered]@{ candidates=@($sourceDefinitions | ForEach-Object { @{id=$_.id;package=$_.package;kind=$_.kind;variants=$_.variants} }) }
    [IO.File]::WriteAllText((Join-Path $stage 'aw01-input.json'),($manifest|ConvertTo-Json -Depth 8)+"`n",[Text.UTF8Encoding]::new($false))
    $env:AW01_STAGE = $stage
    $env:AW01_OUT = $outDir
    $env:AW01_BAKE = 'true'
    $shortScript = (Get-ShortPath (Join-Path $toolsDir 'ue-aw01.py')).ToLowerInvariant()
    $dependencyGraph=$null
    foreach ($phase in @('discover','export')) {
        $env:AW01_PHASE=$phase
        $arguments = @('"'+$projectFile.Replace('\','/')+'"','-run=pythonscript','-script='+$shortScript,'-unattended','-NoSplash','-NoSound','-NoLiveCoding','-nop4','-stdout','-FullStdOutLogOutput')
        if ($phase -eq 'export') { $arguments += '-AllowCommandletRendering' }
        $start = [Diagnostics.ProcessStartInfo]::new()
        $start.FileName=$EngineCmd; $start.Arguments=$arguments -join ' '; $start.UseShellExecute=$false; $start.CreateNoWindow=$true; $start.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
        $process=[Diagnostics.Process]::new(); $process.StartInfo=$start
        if (-not $process.Start()) { throw "Could not start isolated UE5.8 $phase commandlet" }
        $stdoutTask=$process.StandardOutput.ReadToEndAsync(); $stderrTask=$process.StandardError.ReadToEndAsync(); $process.WaitForExit()
        $stdoutPath=Join-Path $logsDir ("aw01.$phase.stdout.log"); $stderrPath=Join-Path $logsDir ("aw01.$phase.stderr.log")
        [IO.File]::WriteAllText($stdoutPath,$stdoutTask.Result,[Text.UTF8Encoding]::new($false)); [IO.File]::WriteAllText($stderrPath,$stderrTask.Result,[Text.UTF8Encoding]::new($false))
        $prepared.commandlet.exitCode=$process.ExitCode; $prepared.commandlet.stdout=$stdoutPath; $prepared.commandlet.stderr=$stderrPath
        if ($process.ExitCode -ne 0) { throw "UE $phase commandlet exited $($process.ExitCode); see $stdoutPath" }
        if ($phase -eq 'discover') {
            $dependencyReport=Join-Path $stage 'aw01-dependencies.json'
            if (-not (Test-Path -LiteralPath $dependencyReport -PathType Leaf)) { throw "UE did not write dependency closure: $dependencyReport" }
            $dependencyData=Get-Content -LiteralPath $dependencyReport -Raw | ConvertFrom-Json
            $dependencyPackages=@($dependencyData.gamePackages)
            $dependencyGraph=$dependencyData.dependencyGraph
            $known=@($copyRecords | Where-Object { $_.package -notmatch '\.(uexp|ubulk)$' } | ForEach-Object { $_.package -replace '\\','/' })
            foreach ($packagePath in $dependencyPackages) {
                $relative=$packagePath -replace '^/Game/',''
                $relative=$relative.Replace('/','\')+'.uasset'
                if ($known -contains $relative.Replace('\','/')) { continue }
                $dependencySource=Join-Path $gameContent $relative
                if (-not (Test-Path -LiteralPath $dependencySource -PathType Leaf)) { throw "Resolved /Game dependency source is missing: $dependencySource" }
                $dependencyRecord=Get-HashRecord $dependencySource 'dependency'
                $dependencyDestination=Join-Path $contentStage $relative
                New-Item -ItemType Directory -Path (Split-Path -Parent $dependencyDestination) -Force | Out-Null
                if (Test-Path -LiteralPath $dependencyDestination) {
                    if ((Get-FileHash -LiteralPath $dependencyDestination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $dependencyRecord.sha256) { throw "Existing staged dependency hash mismatch: $dependencyDestination" }
                } else { Copy-Item -LiteralPath $dependencySource -Destination $dependencyDestination }
                $copyRecords += [pscustomobject]@{source=$dependencySource;staged=$dependencyDestination;package=$packagePath;bytes=$dependencyRecord.bytes;sha256=$dependencyRecord.sha256;id='_dependency'}
                $sources += $dependencyRecord
                foreach ($suffix in @('.uexp','.ubulk')) {
                    $sidecarSource=[IO.Path]::ChangeExtension($dependencySource,$suffix)
                    if (Test-Path -LiteralPath $sidecarSource -PathType Leaf) {
                        $sidecarDest=[IO.Path]::ChangeExtension($dependencyDestination,$suffix)
                        Copy-Item -LiteralPath $sidecarSource -Destination $sidecarDest -Force
                        $sidecarRecord=Get-HashRecord $sidecarSource 'dependency-sidecar'
                        if ((Get-FileHash -LiteralPath $sidecarDest -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sidecarRecord.sha256) { throw "Dependency sidecar copy hash mismatch: $sidecarDest" }
                        $sources += $sidecarRecord
                        $copyRecords += [pscustomobject]@{source=$sidecarSource;staged=$sidecarDest;package=$packagePath+$suffix;bytes=$sidecarRecord.bytes;sha256=$sidecarRecord.sha256;id='_dependency'}
                    }
                }
                $known += $packagePath
            }
        }
    }
    $exportReport=Join-Path $stage 'aw01-output.json'
    if (-not (Test-Path -LiteralPath $exportReport -PathType Leaf)) { throw "UE did not write its output manifest: $exportReport" }
    $prepared.entries=@((Get-Content -LiteralPath $exportReport -Raw | ConvertFrom-Json).entries)
    foreach ($entry in $prepared.entries) {
        $rootPackages=@($sourceDefinitions | Where-Object { $_.id -eq $entry.id } | ForEach-Object { $_.package })
        foreach ($definition in ($sourceDefinitions | Where-Object { $_.id -eq $entry.id })) { $rootPackages += @($definition.variants | Where-Object { $_.package } | ForEach-Object { $_.package }) }
        $packageSet=[Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        $pendingPackages=[Collections.Generic.Queue[string]]::new()
        foreach ($root in $rootPackages) {
            if ($root.ToLowerInvariant().EndsWith('.uasset')) { $key='/Game/'+$root.Substring(0,$root.Length-7).Replace('\','/'); $pendingPackages.Enqueue($key) }
        }
        while ($pendingPackages.Count -gt 0) {
            $key=$pendingPackages.Dequeue()
            if (-not $packageSet.Add($key)) { continue }
            $node=$dependencyGraph.PSObject.Properties[$key]
            if ($node) { foreach ($dependency in $node.Value) { if ($dependency.StartsWith('/Game/')) { $pendingPackages.Enqueue($dependency) } } }
        }
        $packagePaths=@($packageSet | ForEach-Object { ($_ -replace '^/Game/','')+'.uasset' })
        $entryCopies=@($copyRecords | Where-Object {
            $normalized=$_.package -replace '\\','/'
            $normalizedNoExt=$normalized -replace '\.uasset$',''
            ($_.id -eq $entry.id -or $packageSet.Contains('/Game/'+$normalizedNoExt)) -and $_.package -notmatch '\.(uexp|ubulk)$'
        } | Group-Object package | ForEach-Object { $_.Group[0] })
        $entry.sources=@($entryCopies | ForEach-Object { [pscustomobject]@{package=$_.package;sha256=$_.sha256} })
        $revisionInput=($entryCopies | Sort-Object package | ForEach-Object { $_.package+':'+$_.sha256 }) -join "`n"
        $entry | Add-Member -NotePropertyName sourceRevision -NotePropertyValue (Get-StringSha256 $revisionInput) -Force
    }
    }
}

$prepared.sourceHashesAfter = @($sources | ForEach-Object {
    $after=Get-HashRecord $_.path $_.role
    if ($after.bytes -ne $_.bytes -or $after.sha256 -ne $_.sha256) { throw "Original source changed during preparation: $($_.path)" }
    $after
})
$preparedPath=Join-Path $outDir 'prepared.json'
[IO.File]::WriteAllText($preparedPath,($prepared|ConvertTo-Json -Depth 12)+"`n",[Text.UTF8Encoding]::new($false))
Write-Host "AW01 staging created at $stage"
Write-Host "Preparation manifest written to $preparedPath"
if ($Export) {
    $finalizer = Join-Path $PSScriptRoot 'prepare-aw01-finalize.py'
    & python $finalizer
    if ($LASTEXITCODE -ne 0) { throw "AW01 manifest verification/finalization failed with exit code $LASTEXITCODE" }
    & python (Join-Path $PSScriptRoot 'prepare-aw01-verify.py')
    if ($LASTEXITCODE -ne 0) { throw "AW01 output/source verification failed with exit code $LASTEXITCODE" }
    Write-Host 'Publishable AW01 manifest and private preparation receipt verified.'
}
