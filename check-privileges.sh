#!/bin/bash

echo "🔍 Verificando privilegios para SMB Recon Tool"
echo "=============================================="

# Verificar si estamos ejecutando como root
if [[ $EUID -eq 0 ]]; then
    echo "✅ Ejecutando como root - todos los privilegios disponibles"
    exit 0
fi

echo "👤 Usuario actual: $(whoami)"
echo ""

# Verificar masscan instalado
if ! command -v masscan &> /dev/null; then
    echo "❌ masscan no está instalado"
    echo "   Instalar con: sudo apt install masscan"
    exit 1
else
    echo "✅ masscan instalado"
fi

# Verificar smbclient instalado
if ! command -v smbclient &> /dev/null; then
    echo "❌ smbclient no está instalado"
    echo "   Instalar con: sudo apt install smbclient"
    exit 1
else
    echo "✅ smbclient instalado"
fi

echo ""
echo "🔐 Verificando privilegios de sudo para masscan..."

# Verificar sudo sin contraseña
if sudo -n true 2>/dev/null; then
    echo "✅ Sudo sin contraseña configurado"
    echo ""
    echo "🎉 Todo listo! Puedes ejecutar:"
    echo "   ./start.sh"
    exit 0
fi

# Verificar sudo interactivo
if sudo -v 2>/dev/null; then
    echo "✅ Sudo interactivo disponible"
    echo ""
    echo "⚠️  Se pedirá contraseña durante el escaneo"
    echo ""
    echo "💡 Para evitar prompts, configura sudo sin contraseña:"
    echo "   ./setup-sudo.sh"
    echo ""
    echo "🚀 Ejecuta con: ./start.sh"
    exit 0
fi

echo "❌ No hay acceso a sudo"
echo ""
echo "Soluciones disponibles:"
echo ""
echo "1️⃣ Configurar sudo sin contraseña (recomendado):"
echo "   ./setup-sudo.sh"
echo ""
echo "2️⃣ Ejecutar como root:"
echo "   ./start-sudo.sh"
echo ""
echo "3️⃣ Configurar manualmente:"
echo "   echo '$(whoami) ALL=(ALL) NOPASSWD: /usr/bin/masscan' | sudo tee /etc/sudoers.d/masscan"
echo "   sudo chmod 0440 /etc/sudoers.d/masscan"

exit 1