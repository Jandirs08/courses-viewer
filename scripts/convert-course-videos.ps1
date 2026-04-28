param(
  [Parameter(Mandatory = $true)]
  [string]$InputDir,

  [Parameter(Mandatory = $true)]
  [string]$OutputDir,

  [switch]$Overwrite,

  [switch]$CopyUnsupported
)

$ErrorActionPreference = "Stop"

function Require-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "No se encontro '$Name' en PATH. Instala ffmpeg y ffprobe antes de ejecutar este script."
  }
}

function Ensure-Directory {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Get-RelativePathSafe {
  param(
    [string]$BasePath,
    [string]$FullPath
  )

  $baseUri = [System.Uri]((Resolve-Path -LiteralPath $BasePath).Path.TrimEnd('\') + '\')
  $fileUri = [System.Uri](Resolve-Path -LiteralPath $FullPath).Path
  $relativeUri = $baseUri.MakeRelativeUri($fileUri)
  return [System.Uri]::UnescapeDataString($relativeUri.ToString()).Replace('/', '\')
}

Require-Command "ffmpeg"
Require-Command "ffprobe"

$inputRoot = (Resolve-Path -LiteralPath $InputDir).Path
Ensure-Directory -Path $OutputDir
$outputRoot = (Resolve-Path -LiteralPath $OutputDir).Path

$videoExt = @(".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi", ".wmv", ".ts")
$files = Get-ChildItem -LiteralPath $inputRoot -Recurse -File | Where-Object {
  $videoExt -contains $_.Extension.ToLowerInvariant()
}

if ($files.Count -eq 0) {
  throw "No se encontraron videos en '$inputRoot'."
}

Write-Host "Videos detectados: $($files.Count)"
Write-Host "Origen: $inputRoot"
Write-Host "Destino: $outputRoot"

$index = 0
foreach ($file in $files) {
  $index++
  $relativePath = Get-RelativePathSafe -BasePath $inputRoot -FullPath $file.FullName
  $relativeDir = Split-Path -Path $relativePath -Parent
  $destinationDir = if ([string]::IsNullOrWhiteSpace($relativeDir)) { $outputRoot } else { Join-Path $outputRoot $relativeDir }
  Ensure-Directory -Path $destinationDir

  $destinationName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name) + ".mp4"
  $destinationFile = Join-Path $destinationDir $destinationName

  if ((Test-Path -LiteralPath $destinationFile) -and -not $Overwrite) {
    Write-Host "[$index/$($files.Count)] Saltando existente: $relativePath"
    continue
  }

  Write-Host "[$index/$($files.Count)] Convirtiendo: $relativePath"

  $probeJson = & ffprobe -v error -print_format json -show_streams -show_format -- "$($file.FullName)"
  $probe = $probeJson | ConvertFrom-Json
  $videoStream = @($probe.streams) | Where-Object { $_.codec_type -eq "video" } | Select-Object -First 1
  $audioStream = @($probe.streams) | Where-Object { $_.codec_type -eq "audio" } | Select-Object -First 1

  $videoCodec = $videoStream.codec_name
  $audioCodec = $audioStream.codec_name

  $useCopyVideo = $videoCodec -in @("h264", "avc1")
  $useCopyAudio = $audioCodec -in @("aac", "mp4a")

  $ffmpegArgs = @(
    "-hide_banner",
    "-loglevel", "warning",
    "-i", $file.FullName,
    "-map", "0:v:0"
  )

  if ($audioStream) {
    $ffmpegArgs += @("-map", "0:a:0")
  }

  if ($useCopyVideo) {
    $ffmpegArgs += @("-c:v", "copy")
  } else {
    $ffmpegArgs += @(
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "21",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart"
    )
  }

  if ($audioStream) {
    if ($useCopyAudio) {
      $ffmpegArgs += @("-c:a", "copy")
    } else {
      $ffmpegArgs += @("-c:a", "aac", "-b:a", "160k")
    }
  } elseif ($CopyUnsupported) {
    $ffmpegArgs += @("-an")
  }

  $ffmpegArgs += @("-sn")

  if ($Overwrite) {
    $ffmpegArgs += "-y"
  } else {
    $ffmpegArgs += "-n"
  }

  $ffmpegArgs += $destinationFile

  & ffmpeg @ffmpegArgs

  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Fallo al convertir: $relativePath"
  }
}

Write-Host "Proceso completado."
