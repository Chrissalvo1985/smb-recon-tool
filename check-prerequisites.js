#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

console.log('🔍 Checking SMB Recon Tool Prerequisites...\n');

// Check Node.js version
const nodeVersion = process.version;
console.log(`📦 Node.js version: ${nodeVersion}`);
if (parseInt(nodeVersion.split('.')[0].slice(1)) < 16) {
  console.error('❌ Node.js 16+ required');
  process.exit(1);
}

// Check required commands
const requiredCommands = ['masscan', 'smbclient'];
const optionalCommands = ['showmount']; // NFS (2049) enumeration
const missingCommands = [];
const missingOptional = [];

for (const cmd of requiredCommands) {
  try {
    execSync(`which ${cmd}`, { stdio: 'pipe' });
    console.log(`✅ ${cmd} is installed`);
  } catch (error) {
    missingCommands.push(cmd);
    console.log(`❌ ${cmd} is missing`);
  }
}

for (const cmd of optionalCommands) {
  try {
    execSync(`which ${cmd}`, { stdio: 'pipe' });
    console.log(`✅ ${cmd} is installed (NFS support)`);
  } catch (error) {
    missingOptional.push(cmd);
    console.log(`⚠️  ${cmd} is missing (NFS/2049 enumeration disabled)`);
  }
}

if (missingCommands.length > 0) {
  console.log('\n📋 Install missing dependencies:');
  if (missingCommands.includes('masscan')) {
    console.log('   sudo apt install masscan');
  }
  if (missingCommands.includes('smbclient')) {
    console.log('   sudo apt install smbclient');
  }
  console.log('\nThen run: npm run setup');
  process.exit(1);
}

if (missingOptional.length > 0) {
  console.log('\n📋 Optional NFS tools:');
  if (missingOptional.includes('showmount')) {
    console.log('   Linux: sudo apt install nfs-common');
    console.log('   macOS: showmount is built-in (Open Directory tools)');
  }
}

// Check sudo privileges for masscan
console.log('\n🔐 Checking masscan privileges...');
const isRoot = process.getuid && process.getuid() === 0;

if (isRoot) {
  console.log('✅ Running as root - masscan will work');
} else {
  try {
    execSync('sudo -n true', { stdio: 'pipe' });
    console.log('✅ Passwordless sudo configured');
  } catch (error) {
    console.log('⚠️  Masscan requires sudo privileges');
    console.log('   Configure passwordless sudo:');
    console.log(`   echo '${process.env.USER} ALL=(ALL) NOPASSWD: /usr/bin/masscan' | sudo tee /etc/sudoers.d/masscan`);
    console.log('   Or run as root: sudo npm run dev');
  }
}

// Check if backend and frontend dependencies are installed
console.log('\n📂 Checking dependencies...');
const backendPackage = path.join(__dirname, 'backend', 'package.json');
const frontendPackage = path.join(__dirname, 'frontend', 'package.json');

try {
  require(backendPackage);
  console.log('✅ Backend dependencies installed');
} catch (error) {
  console.log('❌ Backend dependencies missing - run: npm run setup');
  process.exit(1);
}

try {
  require(frontendPackage);
  console.log('✅ Frontend dependencies installed');
} catch (error) {
  console.log('❌ Frontend dependencies missing - run: npm run setup');
  process.exit(1);
}

console.log('\n🎉 All prerequisites satisfied!');
console.log('🚀 Ready to start: npm run dev\n');
