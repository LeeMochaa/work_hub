# work_hub 관련 모든 프로세스 종료 스크립트

Write-Host "=== work_hub 관련 프로세스 종료 ===" -ForegroundColor Yellow

# 포트 3000, 4004를 사용하는 프로세스 찾기 및 종료
$ports = @(3000, 4004)
foreach ($port in $ports) {
    Write-Host "`n포트 $port 확인 중..." -ForegroundColor Cyan
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($connections) {
        foreach ($conn in $connections) {
            $pid = $conn.OwningProcess
            $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($process) {
                Write-Host "  PID $pid ($($process.ProcessName)) 종료 중..." -ForegroundColor Yellow
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                Write-Host "  ✓ 종료 완료" -ForegroundColor Green
            }
        }
    } else {
        Write-Host "  포트 $port는 사용 중이 아닙니다." -ForegroundColor Gray
    }
}

# node 프로세스 중 work_hub 관련 프로세스 찾기
Write-Host "`nnode 프로세스 확인 중..." -ForegroundColor Cyan
$nodeProcesses = Get-Process node -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    foreach ($proc in $nodeProcesses) {
        try {
            $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($proc.Id)").CommandLine
            if ($cmdLine -like "*work_hub*" -or $cmdLine -like "*work-hub*") {
                Write-Host "  PID $($proc.Id) ($($proc.ProcessName)) 종료 중..." -ForegroundColor Yellow
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                Write-Host "  ✓ 종료 완료" -ForegroundColor Green
            }
        } catch {
            # 명령줄을 가져올 수 없는 경우 무시
        }
    }
} else {
    Write-Host "  node 프로세스가 없습니다." -ForegroundColor Gray
}

Write-Host "`n=== 완료 ===" -ForegroundColor Green

