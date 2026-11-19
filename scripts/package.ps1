$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stage = Join-Path $project 'release'
$zip = Join-Path $project 'neon-vaults-yandex.zip'
$projectPrefix = $project.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$stagePath = [IO.Path]::GetFullPath($stage)
if (-not $stagePath.StartsWith($projectPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe release directory: $stagePath" }

if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item -LiteralPath (Join-Path $project 'index.html') -Destination $stage
Copy-Item -LiteralPath (Join-Path $project 'dist') -Destination $stage -Recurse
New-Item -ItemType Directory -Path (Join-Path $stage 'assets\ui') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $project 'assets\ui\hero.webp') -Destination (Join-Path $stage 'assets\ui\hero.webp')

if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zip)
try {
  $files = @($archive.Entries | Where-Object { $_.Name } | ForEach-Object { $_.FullName.Replace('\', '/') })
  $allowed = @('index.html', 'dist/game.js', 'dist/styles.css', 'assets/ui/hero.webp')
  $unexpected = @($files | Where-Object { $allowed -notcontains $_ })
  $missing = @($allowed | Where-Object { $files -notcontains $_ })
  $unsafe = @($files | Where-Object { $_ -match '[^\x00-\x7F]' -or $_ -match '\s' })
  $unpackedSize = ($archive.Entries | Measure-Object -Property Length -Sum).Sum
  if ($missing.Count) { throw "Missing production files: $($missing -join ', ')" }
  if ($unexpected.Count) { throw "Unexpected production files: $($unexpected -join ', ')" }
  if ($unsafe.Count) { throw "Unsafe ZIP paths: $($unsafe -join ', ')" }
  if ($unpackedSize -ge 100MB) { throw "Unpacked build exceeds 100 MB" }
} finally {
  $archive.Dispose()
}

$size = (Get-Item -LiteralPath $zip).Length
$stream = [IO.File]::OpenRead($zip)
try {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $hash = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
} finally {
  $stream.Dispose()
}
Write-Output "Created neon-vaults-yandex.zip ($([math]::Round($size / 1KB, 1)) KiB compressed, $([math]::Round($unpackedSize / 1KB, 1)) KiB unpacked)"
Write-Output "Verified 4 production files; root index.html; ASCII paths without spaces; SHA256 $hash"
