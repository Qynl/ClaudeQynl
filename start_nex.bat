@echo off
title Nex
cd /d "%~dp0"
where python >nul 2>nul || (echo Python 3.10+ is required. Install from python.org and tick "Add to PATH". & pause & exit /b 1)
python -c "import aiohttp" 2>nul || (echo Installing the single dependency (aiohttp)... & pip install aiohttp)
echo.
echo Starting Nex... (make sure Ollama is running:  ollama serve  /  ollama pull gpt-oss:20b)
python -m nex.server
pause
