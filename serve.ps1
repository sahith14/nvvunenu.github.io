# serve.ps1 - Nuvvu Nenu Local Server

$port = 5000
$root = if ($PSScriptRoot) { $PSScriptRoot } else { Get-Location }

Write-Host "?? Nuvvu Nenu Server running at http://localhost:$port" -ForegroundColor Cyan
Write-Host "?? Root: $root" -ForegroundColor Gray

$mimeTypes = @{
    ".html" = "text/html"
    ".css"  = "text/css"
    ".js"   = "application/javascript"
    ".json" = "application/json"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".gif"  = "image/gif"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
    ".mp4"  = "video/mp4"
    ".webm" = "video/webm"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Start-Process "http://localhost:$port/index.html"

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $requestPath = $context.Request.Url.AbsolutePath.TrimStart('/')
        if (-not $requestPath) { $requestPath = "index.html" }
        $safePath = [System.IO.Path]::GetFullPath((Join-Path $root $requestPath))
        if (-not $safePath.StartsWith($root, 'OrdinalIgnoreCase')) {
            $context.Response.StatusCode = 403
            $buf = [System.Text.Encoding]::UTF8.GetBytes("403 - Forbidden")
            $context.Response.OutputStream.Write($buf, 0, $buf.Length)
            $context.Response.Close()
            continue
        }
        if (Test-Path $safePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($safePath).ToLower()
            $contentType = $mimeTypes[$ext]
            if (-not $contentType) { $contentType = "application/octet-stream" }
            $context.Response.ContentType = $contentType
            $buf = [System.IO.File]::ReadAllBytes($safePath)
            $context.Response.ContentLength64 = $buf.Length
            $context.Response.OutputStream.Write($buf, 0, $buf.Length)
            Write-Host "$($context.Request.HttpMethod) $requestPath - 200"
        }
        else {
            $context.Response.StatusCode = 404
            $buf = [System.Text.Encoding]::UTF8.GetBytes("404 - Not Found")
            $context.Response.OutputStream.Write($buf, 0, $buf.Length)
            Write-Host "$($context.Request.HttpMethod) $requestPath - 404" -ForegroundColor Red
        }
        $context.Response.Close()
    }
    catch {
        Write-Host "Error: $_" -ForegroundColor Red
    }
}


