@echo off
setlocal
cd /d "%~dp0"
echo.
echo MAREA NEGRA - TABLERO
echo Generando docs\board\board-data.js desde ROADMAP.md, los NOW.md y el estado en vivo...
echo.
node tools\board\build.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
start "" "%~dp0docs\board\index.html"
endlocal
