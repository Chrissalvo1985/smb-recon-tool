#!/bin/bash

echo "🚀 Starting SMB Automated Recon Tool"
echo "====================================="

# Check if masscan and smbclient are installed
if ! command -v masscan &> /dev/null; then
    echo "❌ masscan is not installed. Please install it first:"
    echo "   sudo apt install masscan"
    exit 1
fi

if ! command -v smbclient &> /dev/null; then
    echo "❌ smbclient is not installed. Please install it first:"
    echo "   sudo apt install smbclient"
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 16+ first."
    exit 1
fi

# Check sudo privileges for masscan
echo "🔍 Checking sudo privileges for masscan..."
if sudo -n true &> /dev/null 2>&1; then
    echo "✅ Passwordless sudo configured for masscan"
elif sudo -v &> /dev/null 2>&1; then
    echo "✅ Interactive sudo available - password will be requested during scanning"
else
    echo "⚠️  WARNING: Masscan requires root privileges for raw socket access."
    echo ""
    echo "   You have several options:"
    echo "   1. Configure passwordless sudo (recommended for automation):"
    echo "      ./setup-sudo.sh"
    echo ""
    echo "   2. Run the application as root:"
    echo "      ./start-sudo.sh"
    echo ""
    echo "   3. Continue and enter sudo password when prompted during scanning"
    echo ""
    echo "   Press Enter to continue with option 3 or Ctrl+C to cancel..."
    read
fi

echo "✅ Prerequisites check passed"

# Build frontend (single-port deployment)
echo "🛠  Building frontend..."
(cd frontend && npm run build) || { echo "❌ Frontend build failed"; exit 1; }

# Start backend (serves API + frontend build on port 3005)
echo "🔧 Starting server on port 3005..."
cd backend
npm start &
BACKEND_PID=$!

echo ""
echo "🎯 SMB Recon Tool is running!"
echo "   App:  http://localhost:3005"
echo ""
echo "Press Ctrl+C to stop"

trap "echo '🛑 Stopping...'; kill $BACKEND_PID 2>/dev/null; exit" INT
wait