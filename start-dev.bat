@echo off
REM Development environment startup script for Kenny & Morgan's Wedding Website (Windows)

echo ================================================
echo Kenny ^& Morgan's Wedding Website - Dev Setup
echo ================================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [X] Node.js is not installed. Please install Node.js first.
    echo     Visit: https://nodejs.org/
    pause
    exit /b 1
)

echo [OK] Node.js found
node --version
echo [OK] npm found
call npm --version
echo.

REM Check if dependencies are installed
if not exist "node_modules" (
    echo [*] Installing dependencies...
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo [X] Failed to install dependencies
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed successfully
    echo.
)

REM Check if .env file exists
if not exist ".env" (
    echo [!] .env file not found. Creating from .env.example...
    copy .env.example .env
    echo [OK] Created .env file
    echo [!] Please edit .env and add your registry IDs
    echo.
)

REM Start the backend server
echo [*] Starting backend API server...
start /B node server.js
timeout /t 2 /nobreak >nul
echo [OK] Backend server started on http://localhost:3000
echo.

REM Start the frontend server
echo [*] Starting frontend server...
echo [OK] Frontend will be available at http://localhost:8000
echo.
echo Press Ctrl+C to stop both servers
echo.
echo ================================================
echo Development environment is ready!
echo   Backend API: http://localhost:3000
echo   Frontend:    http://localhost:8000
echo ================================================
echo.

python -m http.server 8000

echo.
echo Servers stopped. Thanks for developing!
pause
