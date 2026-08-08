# Simple static file HTTP server for the dashboard (no dependencies).
# Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1 [port]
Add-Type -AssemblyName System.Net.Http

$port = 8080
if ($args.Count -gt 0) { $port = [int]$args[0] }
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()

Write-Host "Serving dashboard at http://localhost:$port  (Ctrl+C to stop)" -ForegroundColor Green

$mime = @{
  '.html' = 'text/html'
  '.js'   = 'application/javascript'
  '.css'  = 'text/css'
  '.json' = 'application/json'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.csv'  = 'text/csv'
  '.txt'  = 'text/plain'
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response

  $urlPath = $req.Url.AbsolutePath
  if ($urlPath -eq '/') { $urlPath = '/index.html' }

  $fullPath = [System.IO.Path]::GetFullPath((Join-Path $root $urlPath.TrimStart('/')))
  if (-not $fullPath.StartsWith($root)) {
    $res.StatusCode = 403
    $res.Close()
    continue
  }

  try {
    if (Test-Path $fullPath -PathType Leaf) {
      $bytes = [System.IO.File]::ReadAllBytes($fullPath)
      $ext = [System.IO.Path]::GetExtension($fullPath).ToLower()
      if ($mime.ContainsKey($ext)) { $res.ContentType = $mime[$ext] }
      else { $res.ContentType = 'application/octet-stream' }
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
      $body = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
      $res.ContentLength64 = $body.Length
      $res.OutputStream.Write($body, 0, $body.Length)
    }
  } catch {
    $res.StatusCode = 500
  } finally {
    $res.Close()
  }
}
