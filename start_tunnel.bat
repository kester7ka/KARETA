@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo === KARETA: туннель к порту 8000 (нужен запущенный start_server.bat) ===
echo Скачай cloudflared.exe для Windows и положи в эту папку KARETA
echo   https://github.com/cloudflare/cloudflared/releases
echo Либо добавь cloudflared в PATH.
echo.
set "EXE=%~dp0cloudflared.exe"
if exist "%EXE%" (
  "%EXE%" tunnel --url http://127.0.0.1:8000
  goto :end
)
where cloudflared >nul 2>&1
if %ERRORLEVEL% equ 0 (
  cloudflared tunnel --url http://127.0.0.1:8000
  goto :end
)
echo [Ошибка] Не найден cloudflared.exe в папке проекта и не в PATH.
echo Скачай: https://github.com/cloudflare/cloudflared/releases  (windows-amd64.exe переименуй в cloudflared.exe)
pause
:end
pause
