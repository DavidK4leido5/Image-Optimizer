<#
  End-to-end check against a running stack.
  Usage: scripts/smoke.ps1 [-Api http://localhost:5080] [-Key dev-local-key]
#>
param(
    [string]$Api = "http://localhost:5080",
    [string]$Key = "dev-local-key",
    [int]$WaitSeconds = 90
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Net.Http

function Assert-Equal($actual, $expected, $label) {
    if ($actual -ne $expected) { throw "$label expected '$expected' got '$actual'" }
    Write-Host "ok  $label"
}

$health = Invoke-RestMethod "$Api/health" -TimeoutSec 10
Assert-Equal $health.status "ok" "api health"

$file = Join-Path $env:TEMP "cloudinary-smoke.jpg"
$bitmap = [System.Drawing.Bitmap]::new(1200, 800)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::FromArgb(20, 70, 140))
$graphics.FillEllipse([System.Drawing.Brushes]::Orange, 120, 120, 520, 520)
$graphics.FillRectangle([System.Drawing.Brushes]::White, 700, 150, 380, 500)
$graphics.Dispose()
$bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$bitmap.Dispose()

$headers = @{ "X-Api-Key" = $Key }
$body = @{ fileName = "smoke.jpg"; contentType = "image/jpeg"; bytes = (Get-Item $file).Length } | ConvertTo-Json
$created = Invoke-RestMethod -Method Post -Uri "$Api/v1/assets" -Headers $headers -ContentType "application/json" -Body $body

$client = [System.Net.Http.HttpClient]::new()
$content = [System.Net.Http.ByteArrayContent]::new([System.IO.File]::ReadAllBytes($file))
$content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("image/jpeg")
$request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Put, $created.upload.url)
$request.Content = $content
$put = $client.SendAsync($request).Result
Assert-Equal ([int]$put.StatusCode) 200 "presigned put"

Invoke-RestMethod -Method Post -Uri "$Api/v1/assets/$($created.publicId)/complete" -Headers $headers | Out-Null

$asset = $null
foreach ($attempt in 1..$WaitSeconds) {
    Start-Sleep -Seconds 1
    $asset = Invoke-RestMethod -Uri "$Api/v1/assets/$($created.publicId)" -Headers $headers
    if ($asset.status -in @("ready", "failed")) { break }
}

Assert-Equal $asset.status "ready" "asset processed"
Assert-Equal $asset.variants.Count 3 "variant count"

$response = $client.GetAsync("$Api$($asset.variants[0].url)").Result
$bytes = $response.Content.ReadAsByteArrayAsync().Result
Assert-Equal ([int]$response.StatusCode) 200 "delivery"
Assert-Equal ([System.Text.Encoding]::ASCII.GetString($bytes[0..3])) "RIFF" "webp container"

$unauthorized = $false
try { Invoke-RestMethod -Uri "$Api/v1/assets" -TimeoutSec 5 | Out-Null }
catch { $unauthorized = $_.Exception.Response.StatusCode.value__ -eq 401 }
Assert-Equal $unauthorized $true "missing key rejected"

Invoke-RestMethod -Method Delete -Uri "$Api/v1/assets/$($created.publicId)" -Headers $headers | Out-Null
Write-Host "smoke passed"
