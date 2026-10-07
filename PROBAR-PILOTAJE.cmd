@echo off
setlocal
cd /d "%~dp0"
echo.
echo Marea Negra - Piloto y cubierta movil, ensayo local
echo Abre http://127.0.0.1:5180/tools/naval-pilot/
echo Subir/Bajar al timon. W/S acelerar/frenar; A/D girar.
echo Esta prueba no guarda progreso ni mueve bienes de una cuenta.
echo.
node tools/naval-lab.mjs --port=5180
if errorlevel 1 pause
