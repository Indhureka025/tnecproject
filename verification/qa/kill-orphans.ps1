# Kill any EC-service / webhook-sink test processes left running.
$ports = 8080,8100,8101,8123,9109
foreach ($p in $ports) {
  try {
    Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique |
      ForEach-Object {
        Write-Host "killing PID $_ on port $p"
        Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
      }
  } catch { }
}
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and ($_.CommandLine -match 'src[\\/]index\.ts' -or $_.CommandLine -match 'webhook-sink\.mjs') } |
  ForEach-Object {
    Write-Host "killing PID $($_.ProcessId) (cmdline match)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
Write-Host "done"
