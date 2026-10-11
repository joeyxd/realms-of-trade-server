@echo off
cd /d "%~dp0"
node tools\host-pc.mjs --stop
if errorlevel 1 pause
