@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo === KARETA: туннель к порту 8000 (нужен запущенный start_server.bat) ===
echo Сообщение ERR про cert.pem у quick-tunnel часто можно игнорировать — туннель всё равно поднимается.
echo По умолчанию: связь с Cloudflare по HTTP/2, не по QUIC/UDP — так обычно уходит ошибка
echo   timeout: no recent network activity на нестабильном UDP или из-за файрвола.
echo Чтобы снова пробовать QUIC: установи переменную KARETA_TUNNEL_QUIC=1 перед запуском этого bat.
echo.
echo Сначала в другом окне запусти start_server.bat и дождись: Uvicorn running on http://127.0.0.1:8000
echo.

set "CF="
if exist "%~dp0cloudflared.exe" set "CF=%~dp0cloudflared.exe"
if not defined CF if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not defined CF if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"

if defined CF goto :run_cf

where cloudflared >nul 2>&1
if %ERRORLEVEL% neq 0 goto :no_cf
for /f "delims=" %%i in ('where cloudflared') do (
  set "CF=%%i"
  goto :run_cf
)

:no_cf
echo [Ошибка] Не найден cloudflared.exe.
echo — Положи cloudflared.exe в папку KARETA: https://github.com/cloudflare/cloudflared/releases
echo   ^(windows-amd64.exe переименуй в cloudflared.exe^)
echo — Или установи cloudflared и добавь в PATH.
pause
exit /b 1

:run_cf
echo Используется: "%CF%"
echo.

netstat -an | findstr ":8000" | findstr "LISTENING" >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo [Предупреждение] Порт 8000 пока не в состоянии LISTENING — сервер, возможно, не запущен. Туннель стартанёт, но сайт отдаст 502, пока не поднимешь backend.
  echo.
)

set "PROTO=--protocol http2"
if /I "%KARETA_TUNNEL_QUIC%"=="1" set "PROTO="
"%CF%" tunnel --url http://127.0.0.1:8000 %PROTO%
echo.
pause
