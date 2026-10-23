@echo off
cd /d "%~dp0"
echo Enter the Foundry origin shown in your browser, such as http://localhost:30000
set /p TELY_FOUNDRY_ORIGIN=Foundry origin: 
if "%TELY_FOUNDRY_ORIGIN%"=="" set TELY_FOUNDRY_ORIGIN=http://localhost:30000
py -3 bridge.py --allow-origin "%TELY_FOUNDRY_ORIGIN%"
if errorlevel 1 python bridge.py --allow-origin "%TELY_FOUNDRY_ORIGIN%"
pause
