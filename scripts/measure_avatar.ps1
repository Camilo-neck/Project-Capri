# Average CPU and GPU (3D engine) use of the running Capri window: avatar.exe plus its WebView2 processes.
# Run while the avatar is open, e.g. started with $env:CAPRI_STYLE = "pixel"; npm run tauri dev
# Usage: powershell -File scripts/measure_avatar.ps1 [-Seconds 20]
param([int]$Seconds = 20)

$app = Get-Process avatar -ErrorAction Stop | Select-Object -First 1
$pids = @($app.Id) + @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
    Where-Object { $_.CommandLine -like "*com.capri.avatar*" } | ForEach-Object ProcessId)

$cpu0 = ($pids | ForEach-Object { (Get-Process -Id $_).TotalProcessorTime.TotalMilliseconds } | Measure-Object -Sum).Sum
$samples = Get-Counter "\GPU Engine(*engtype_3D)\Utilization Percentage" -SampleInterval 1 -MaxSamples $Seconds
$cpu1 = ($pids | ForEach-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue).TotalProcessorTime.TotalMilliseconds } | Measure-Object -Sum).Sum

$gpu = ($samples | ForEach-Object {
    ($_.CounterSamples | Where-Object { $_.InstanceName -match "pid_(\d+)_" -and [int]$Matches[1] -in $pids } |
        Measure-Object CookedValue -Sum).Sum
} | Measure-Object -Average).Average

$cores = [Environment]::ProcessorCount
"processes: $($pids.Count)"
"CPU: {0:N1}% of one core ({1:N2}% of total)" -f (($cpu1 - $cpu0) / ($Seconds * 10)), (($cpu1 - $cpu0) / ($Seconds * 10 * $cores))
"GPU 3D: {0:N1}%" -f $gpu
