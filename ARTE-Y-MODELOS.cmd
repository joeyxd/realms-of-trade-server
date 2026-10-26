@echo off
setlocal
cd /d "%~dp0"
echo.
echo MAREA NEGRA - INDICE DE ARTE Y MODELOS
echo Generando ARTE-Y-MODELOS.html con todas las piezas, archivos y problemas...
echo.
node tools\asset-index\build.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
start "" "%~dp0ARTE-Y-MODELOS.html"
endlocal
