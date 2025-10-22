#!/bin/bash

# Development environment startup script for Kenny & Morgan's Wedding Website

echo "🎊 Kenny & Morgan's Wedding Website - Development Setup 🎊"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js found: $(node --version)"
echo "✅ npm found: $(npm --version)"
echo ""

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install dependencies"
        exit 1
    fi
    echo "✅ Dependencies installed successfully"
    echo ""
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found. Creating from .env.example..."
    cp .env.example .env
    echo "✅ Created .env file"
    echo "⚠️  Please edit .env and add your registry IDs"
    echo ""
fi

# Start the backend server in the background
echo "🚀 Starting backend API server..."
node server.js &
SERVER_PID=$!
echo "✅ Backend server started (PID: $SERVER_PID) on http://localhost:3000"
echo ""

# Wait for server to start
sleep 2

# Check if server is running
if curl -s http://localhost:3000/api/health > /dev/null; then
    echo "✅ Backend server is healthy"
else
    echo "⚠️  Backend server may not be responding"
fi
echo ""

# Start the frontend server
echo "🚀 Starting frontend server..."
echo "✅ Frontend will be available at http://localhost:8000"
echo ""
echo "📝 To stop the servers:"
echo "   Press Ctrl+C to stop the frontend server"
echo "   Then run: kill $SERVER_PID  (to stop the backend server)"
echo ""
echo "🎉 Development environment is ready!"
echo "   Backend API: http://localhost:3000"
echo "   Frontend:    http://localhost:8000"
echo ""

# Start frontend server
python3 -m http.server 8000

# Cleanup when frontend server stops
kill $SERVER_PID 2>/dev/null
echo ""
echo "👋 Servers stopped. Thanks for developing!"
