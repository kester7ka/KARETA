@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo === KARETA: именованный Cloudflare Tunnel (постоянный HTTPS-URL) ===
echo Нужны: аккаунт Cloudflare, домен в Cloudflare, токен из Zero Trust (см. README).
echo Сначала запусти start_server.bat — backend на порту 8000.
echo.

set "CF="
if exist "%~dp0cloudflared.exe" set "CF=%~dp0cloudflared.exe"
if not defined CF if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not defined CF if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"
if defined CF goto :find_token
where cloudflared >nul 2>&1
if %ERRORLEVEL% neq 0 goto :no_cf
for /f "delims=" %%i in ('where cloudflared') do set "CF=%%i" & goto :find_token

:no_cf
echo [Ошибка] Не найден cloudflared.exe. См. README и start_tunnel.bat.
pause
exit /b 1

:find_token
set "TOKEN="
if exist "%~dp0tunnel_token.txt" (
  for /f "usebackq delims=" %%a in ("%~dp0tunnel_token.txt") do set "TOKEN=%%a" & goto :have_token
)
:have_token
if not defined TOKEN if not "%KARETA_TUNNEL_TOKEN%"=="" set "TOKEN=%KARETA_TUNNEL_TOKEN%"
if not defined TOKEN goto :no_token

echo Используется: "%CF%"
echo.
set "PROTO=--protocol http2"
if /I "%KARETA_TUNNEL_QUIC%"=="1" set "PROTO="
"%CF%" tunnel %PROTO% run --token "%TOKEN%"
echo.
pause
exit /b 0

:no_token
echo [Ошибка] Нет токена туннеля.
echo.
echo 1) В Cloudflare Zero Trust создай Tunnel и скопируй токен коннектора.
echo 2) Сохрани его в файл %~dp0tunnel_token.txt ^(одна строка, без пробелов в начале/конце^).
echo    Либо задай переменную окружения KARETA_TUNNEL_TOKEN.
echo 3) В туннеле укажи Public Hostname: твой поддомен ^-^> http://127.0.0.1:8000
echo Подробно: раздел README «Постоянный URL».
echo.
pause
exit /b 1
