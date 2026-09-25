#!/bin/bash

echo "🔐 Starting SMB Automated Recon Tool (with sudo)"
echo "================================================="

# Check if we're running as root
if [[ $EUID -eq 0 ]]; then
    echo "✅ Already running as root"
else
    echo "🔄 Re-executing with sudo..."
    exec sudo "$0" "$@"
fi

echo "🚀 Starting SMB Automated Recon Tool as root"
echo "=============================================="

# Check prerequisites (now that we have root)
if ! command -v masscan &> /dev/null; then
    echo "❌ masscan is not installed. Please install it first:"
    echo "   apt install masscan"
    exit 1
fi

if ! command -v smbclient &> /dev/null; then
    echo "❌ smbclient is not installed. Please install it first:"
    echo "   apt install smbclient"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ first."
    exit 1
fi

echo "✅ Prerequisites check passed"

# Set proper ownership for log files
touch backend/logs/combined.log backend/logs/error.log 2>/dev/null || true
chown $(whoami):$(whoami) backend/logs/*.log 2>/dev/null || true

# Build frontend (single-port deployment)
echo "🛠  Building frontend..."
(cd frontend && npm run build) || { echo "❌ Frontend build failed"; exit 1; }

# Start backend (serves API + frontend build on port 3005)
echo "🔧 Starting server on port 3005..."
cd backend
npm start &
BACKEND_PID=$!

echo ""
echo "🎯 SMB Recon Tool is running as root!"
echo "   App:  http://localhost:3005"
echo ""
echo "⚠️  Running with elevated privileges - use carefully"
echo ""
echo "Press Ctrl+C to stop"

trap "echo '🛑 Stopping...'; kill $BACKEND_PID 2>/dev/null; exit" INT
wait