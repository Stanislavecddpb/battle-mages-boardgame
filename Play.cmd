@echo off
cd /d "%~dp0"
where node.exe >nul 2>nul || (echo Install Node.js 24 to host games. & pause & exit /b 1)
node launch.js
pause
