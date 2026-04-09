@echo off
echo Starting SmartSpend backend...

REM Load key from .env if it exists
if exist .env (
    for /f "usebackq tokens=1,2 delims==" %%A in (".env") do (
        if "%%A"=="GROQ_API_KEY" set GROQ_API_KEY=%%B
    )
)

if "%GROQ_API_KEY%"=="" (
    echo ERROR: GROQ_API_KEY not set.
    echo Copy .env.example to .env and paste your Groq key.
    pause
    exit /b 1
)

python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
