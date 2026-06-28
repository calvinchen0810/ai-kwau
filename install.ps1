# AI Kwau (愛看有) 安裝程式
# 由 install.bat 呼叫，或直接以 PowerShell 執行

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Stop'

if ($MyInvocation.MyCommand.Path) {
    $ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
    $ScriptDir = $PWD.Path
}

function Pause-Exit($code) {
    Write-Host ""
    Read-Host "  按 Enter 離開"
    exit $code
}

function Show-Error($msg) {
    Write-Host ""
    Write-Host "  [錯誤] $msg" -ForegroundColor Red
    Pause-Exit 1
}

# ── 標題 ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  =========================================="
Write-Host "   AI Kwau (愛看有) 安裝程式"
Write-Host "  =========================================="
Write-Host ""

# ── 確認 Microsoft Edge 已安裝 ───────────────────────────────────────────────
$edgePaths = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$edgeExe = $edgePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edgeExe) {
    Show-Error "找不到 Microsoft Edge，請確認已安裝後重試。"
}
Write-Host "  [OK] Microsoft Edge 已找到。"
Write-Host ""

# ── 確認 host 程式存在 ───────────────────────────────────────────────────────
if (-not (Test-Path "$ScriptDir\host\native_host.exe")) {
    Show-Error "找不到 host\native_host.exe。`n         請確認整個 aikwau-dist 資料夾已完整複製。"
}
if (-not (Test-Path "$ScriptDir\host\register.exe")) {
    Show-Error "找不到 host\register.exe。`n         請確認整個 aikwau-dist 資料夾已完整複製。"
}

# ── 確認模型存在 ─────────────────────────────────────────────────────────────
if (-not (Test-Path "$ScriptDir\models\qwen2.5-1.5b-int4\openvino_model.bin")) {
    Show-Error "找不到模型檔案。`n         請確認 models\qwen2.5-1.5b-int4\ 資料夾已完整複製。"
}
Write-Host "  [OK] 模型檔案已找到。"
Write-Host ""

# ── 步驟 1/2：載入 Edge 擴充功能 ────────────────────────────────────────────
Write-Host "  ------------------------------------------"
Write-Host "   步驟 1/2：載入 Edge 擴充功能"
Write-Host "  ------------------------------------------"
Write-Host ""
Write-Host "  1. 開啟 Microsoft Edge"
Write-Host "  2. 網址列輸入：edge://extensions"
Write-Host "  3. 右上角開啟「開發人員模式」"
Write-Host "  4. 點選「載入已解壓縮的擴充功能」"
Write-Host "  5. 選取此目錄下的 extension 資料夾："
Write-Host "     $ScriptDir\extension"
Write-Host "  6. 載入後複製 AI Kwau 的 32 字元 ID"
Write-Host "     （範例：abcdefghijklmnopqrstuvwxyz123456）"
Write-Host ""

$extId = (Read-Host "  請貼上 Extension ID 後按 Enter").Trim()

if ([string]::IsNullOrEmpty($extId)) {
    Show-Error "Extension ID 不可為空。"
}

if ($extId.Length -ne 32) {
    Write-Host ""
    Write-Host "  [警告] ID 長度為 $($extId.Length) 字元，標準應為 32 個小寫英文字母。" -ForegroundColor Yellow
    Write-Host "          輸入值：$extId"
    Write-Host ""
    $cont = (Read-Host "  確定要繼續嗎？(y/N)").Trim()
    if ($cont -notin @('y', 'Y')) {
        Write-Host "  已取消。"
        Pause-Exit 1
    }
}

# ── 步驟 2/2：登錄 Native Messaging Host ────────────────────────────────────
Write-Host ""
Write-Host "  ------------------------------------------"
Write-Host "   步驟 2/2：登錄 Native Messaging Host"
Write-Host "  ------------------------------------------"
Write-Host ""
Write-Host "  正在登錄，請稍候..."
Write-Host ""

& "$ScriptDir\host\register.exe" --extension-id $extId
if ($LASTEXITCODE -ne 0) {
    Show-Error "登錄失敗，請確認 Extension ID 是否正確後重新執行。"
}

# ── 完成 ─────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Green
Write-Host "   安裝完成！" -ForegroundColor Green
Write-Host "  ==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  後續步驟："
Write-Host ""
Write-Host "  1. 回到 edge://extensions"
Write-Host "  2. 找到 AI Kwau，點選重新整理圖示"
Write-Host "  3. 開啟任何新聞或文章頁面"
Write-Host "  4. 將滑鼠懸停在段落上約 1.5 秒"
Write-Host "     - 文字變粗變深（L1 效果）"
Write-Host "     - 右下角出現藍色摘要卡片"
Write-Host ""
Write-Host "  眼球追蹤：點選 Edge 工具列的 AI Kwau 圖示，"
Write-Host "  切換「眼球追蹤」模式，並點選「重新校準」。"
Write-Host ""
Pause-Exit 0
