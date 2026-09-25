#!/bin/bash

echo "🔧 Setting up passwordless sudo for masscan"
echo "==========================================="

# Get the current user
CURRENT_USER=$(whoami)

echo "Current user: $CURRENT_USER"
echo ""

# Create sudoers file for masscan
SUDOERS_FILE="/etc/sudoers.d/masscan"
SUDOERS_ENTRY="$CURRENT_USER ALL=(ALL) NOPASSWD: /usr/bin/masscan"

echo "Creating sudoers entry: $SUDOERS_ENTRY"
echo "This will allow $CURRENT_USER to run masscan without password."
echo ""

# Check if file already exists
if [ -f "$SUDOERS_FILE" ]; then
    echo "⚠️  Sudoers file already exists. Checking contents..."
    if grep -q "$SUDOERS_ENTRY" "$SUDOERS_FILE"; then
        echo "✅ Masscan sudo permissions already configured!"
        exit 0
    else
        echo "📝 Updating existing sudoers file..."
    fi
fi

# Create or update the sudoers file
echo "$SUDOERS_ENTRY" | sudo tee "$SUDOERS_FILE" > /dev/null

# Set proper permissions
sudo chmod 0440 "$SUDOERS_FILE"

echo ""
echo "✅ Passwordless sudo configured for masscan!"
echo "🎉 You can now run: npm run dev"
echo ""
echo "Test it with: npm run check"