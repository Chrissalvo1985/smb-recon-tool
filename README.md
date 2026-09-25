# SMB Automated Recon Tool

A comprehensive tool for automated SMB (Server Message Block) reconnaissance, discovery, and access validation. Built with Node.js backend and React frontend.

## Features

- **Masscan Integration**: Fast port scanning for SMB (139, 445) and NFS (2049)
- **SMB Enumeration**: Automatic share discovery using smbclient
- **NFS Enumeration**: Automatic export discovery using `showmount -e`
- **Access Validation**: Test read access to discovered SMB shares and NFS exports
- **Real-time Progress**: Live updates during scanning process
- **Modern UI**: Dark-mode interface with detailed results visualization
- **Critical Findings**: Highlight shares/exports with anonymous read access
- **Export Functionality**: JSON export of scan results

## Architecture

- **Backend**: Node.js with Express and Socket.IO
- **Frontend**: React with Tailwind CSS
- **Communication**: REST API + WebSocket for real-time updates

## Prerequisites

### System Requirements
- Linux environment
- **Root privileges** or passwordless sudo for masscan (required for raw socket access)
- `masscan` installed (`sudo apt install masscan`)
- `smbclient` installed (`sudo apt install smbclient`)
- `showmount` for NFS (`sudo apt install nfs-common` on Linux; built-in on macOS)
- Node.js 16+ and npm

### Installation

1. **Navigate to the project**:
```bash
cd smb-recon-tool
```

2. **Install all dependencies** (one command):
```bash
npm run setup
```

This installs dependencies for root, backend, and frontend automatically.

## Quick Start

### One Command Startup (Recommended)

Simply run from the project root:

```bash
npm run dev
```

This will:
- ✅ Check all prerequisites automatically (masscan, smbclient, Node.js, permissions)
- ✅ Verify sudo privileges for masscan
- ✅ Start backend server on port 3005
- ✅ Start frontend on port 3000
- ✅ Provide access URLs

### Alternative Commands

```bash
# Check prerequisites only
npm run check

# Production build
npm run start

# Setup (first time only)
npm run setup

# Clean reinstall
npm run clean && npm run setup
```

### Manual Startup

If you prefer manual control:

1. **Start the backend**:
```bash
cd backend
npm run dev
```
Backend will run on `http://localhost:3005`

2. **Start the frontend** (in a new terminal):
```bash
cd frontend
npm start
```
Frontend will run on `http://localhost:3000`

### Production Mode

1. **Build the frontend**:
```bash
cd frontend
npm run build
```

2. **Start the backend**:
```bash
cd backend
npm start
```

Access the application at `http://localhost:3005`

## Configuration Parameters

### Masscan Settings
- **IP Range**: Target network range (CIDR notation or single IP)
- **Ports**: SMB/NFS ports to scan (default: 139,445,2049)
- **Rate**: Packets per second (default: 1500)
- **Seed**: Randomization seed (default: 22346)
- **Source Port**: Spoofed source port (default: 80)
- **Wait**: Response wait time in seconds (default: 5)
- **Randomize Hosts**: Shuffle scan order (default: enabled)
- **Exclude Subnets**: Networks to skip

## Scan Workflow

1. **Masscan Phase**: Identifies hosts with open SMB (139/445) and/or NFS (2049) ports
2. **Enumeration Phase**: Discovers SMB shares (`smbclient -L`) and NFS exports (`showmount -e`)
3. **Validation Phase**: Tests read access (SMB null session / NFS temp mount)

## Output Structure

Results are structured as:

```json
{
  "192.168.1.100": {
    "host_status": "reachable",
    "open_ports": [139, 445, 2049],
    "shares": {
      "Public": {
        "type": "Disk",
        "access": "READ",
        "evidence": "ls successful"
      },
      "/export": {
        "type": "NFS",
        "protocol": "nfs",
        "clients": "*",
        "access": "READ",
        "evidence": "nfs mount + readdir confirmed"
      }
    }
  }
}
```

## Security Considerations

- **Root privileges required**: Masscan needs sudo access for raw socket operations
- Tool runs with elevated system privileges
- Requires `masscan` and `smbclient` system access
- Network scanning may trigger security alerts and IDS systems
- Anonymous share access indicates potential security issues
- Use responsibly and with proper authorization only
- Consider running in isolated environments

## Troubleshooting

### General Issues
- Run `npm run check` to verify all prerequisites
- Ensure you're in the project root directory
- Run `npm run setup` if dependencies are missing

### Backend Issues
- Ensure Node.js 16+ is installed
- Check if port 3005 is available
- Verify `masscan` and `smbclient` are installed

### Frontend Issues
- Ensure backend is running on port 3005
- Check browser console for connection errors
- Verify CORS settings if accessing remotely

### Scanning Issues
- Confirm network connectivity to target ranges
- Check firewall rules that may block scanning
- Verify SMB services are running on targets
- **Masscan permissions**: Masscan requiere privilegios de root para acceso a raw sockets
  - **Opción 1 (Recomendada)**: Configurar sudo sin contraseña:
    ```bash
    ./setup-sudo.sh
    ./start.sh
    ```
  - **Opción 2**: Ejecutar como root:
    ```bash
    ./start-sudo.sh
    ```
  - **Opción 3**: Inicio normal (pedirá contraseña durante el escaneo):
    ```bash
    ./start.sh
    ```
- Ensure proper permissions for system command execution

## Development

### Backend Structure
```
backend/
├── src/
│   ├── routes/          # API endpoints
│   ├── services/        # Core scanning logic
│   └── utils/          # Helper utilities
├── logs/               # Application logs
└── package.json
```

### Frontend Structure
```
frontend/
├── src/
│   ├── components/     # React components
│   └── utils/         # Frontend utilities
├── public/            # Static assets
└── package.json
```

## License

MIT License - Use at your own risk.

## Disclaimer

This tool is for educational and authorized security testing purposes only. Unauthorized network scanning may violate laws and terms of service. Always obtain proper authorization before scanning networks or systems.