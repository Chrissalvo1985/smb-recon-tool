// Script de prueba para verificar el flujo del modal de contraseña de sudo
// Este script simula el comportamiento del frontend

const testScanFlow = async () => {
  console.log('🧪 Probando flujo del modal de contraseña de sudo...');

  // 1. Intentar escaneo sin contraseña (debería fallar)
  console.log('\n1️⃣ Intentando escaneo sin contraseña...');
  try {
    const response1 = await fetch('http://localhost:3005/api/scan/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ipRange: '192.168.1.0/24', ports: '445', rate: 1000 })
    });

    const data1 = await response1.json();
    if (!response1.ok) {
      console.log('✅ Error esperado:', data1.error);
      if (data1.error.includes('root privileges')) {
        console.log('✅ El backend detecta correctamente la necesidad de privilegios');
      }
    } else {
      console.log('❌ No se esperaba éxito:', data1);
    }
  } catch (error) {
    console.log('❌ Error de red:', error.message);
  }

  // 2. Intentar escaneo con contraseña incorrecta (debería fallar)
  console.log('\n2️⃣ Intentando escaneo con contraseña incorrecta...');
  try {
    const response2 = await fetch('http://localhost:3005/api/scan/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ipRange: '192.168.1.0/24',
        ports: '445',
        rate: 1000,
        sudoPassword: 'wrongpassword'
      })
    });

    const data2 = await response2.json();
    if (!response2.ok) {
      console.log('✅ Error esperado:', data2.error);
      if (data2.error.includes('Invalid sudo password')) {
        console.log('✅ El backend valida correctamente la contraseña');
      }
    } else {
      console.log('❌ No se esperaba éxito:', data2);
    }
  } catch (error) {
    console.log('❌ Error de red:', error.message);
  }

  // 3. Nota: No podemos probar con contraseña correcta por seguridad
  console.log('\n3️⃣ Para probar con contraseña correcta:');
  console.log('   - Abre http://localhost:3000 en tu navegador');
  console.log('   - Configura un escaneo');
  console.log('   - Cuando aparezca el modal, ingresa tu contraseña real');
  console.log('   - El escaneo debería funcionar correctamente');

  console.log('\n🎉 Pruebas completadas!');
};

// Ejecutar las pruebas
testScanFlow().catch(console.error);