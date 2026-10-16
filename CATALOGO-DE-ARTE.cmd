@echo off
setlocal
cd /d "%~dp0"
echo.
echo MAREA NEGRA - CATALOGO DE ARTE
echo Abre http://127.0.0.1:5190 en tu navegador.
echo Deja esta ventana abierta mientras utilizas el catalogo.
echo.
node tools\art-catalog\server.mjs
if errorlevel 1 pause
endlocal
