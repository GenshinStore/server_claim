const io = require('socket.io-client');
const { spawn } = require('child_process');

// MENGGUNAKAN PORT 3001
const VPS_URL = 'http://72.61.116.57:3001'; 
const AUTH_TOKEN = 'q7t0Ag#sN)hZxyMx'; 

console.log('🔄 Menghubungkan ke Server Khusus..');

const socket = io(VPS_URL, {
    auth: { token: AUTH_TOKEN },
    reconnection: true,             
    reconnectionAttempts: Infinity, 
    reconnectionDelay: 1000
});

socket.on('connect', () => {
    console.log('✅ BERHASIL TERHUBUNG!');
    console.log('⚡ Menunggu link dari Grup Target...');
});

socket.on('connect_error', (err) => {
    console.log('❌ Gagal terhubung:', err.message);
});

socket.on('disconnect', () => {
    console.log('🔴 Terputus. Mencoba menyambung kembali...');
});

socket.on('eksekusi_link', (data) => {
    console.log(`🚀 [Bot Pelanggan] Mengeksekusi: ${data.link}`);
    spawn('termux-open-url', [data.link], { detached: true, stdio: 'ignore' }).unref();
});