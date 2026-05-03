const io = require('socket.io-client');
const { spawn } = require('child_process');

// ================= PENGATURAN KONEKSI =================
// Ganti dengan IP VPS Hostinger Anda
const VPS_URL = 'http://72.61.116.57:3000'; 

// Harus sama persis dengan yang ada di script VPS
const AUTH_TOKEN = 'q7t0Ag#sN)hZxyMx'; 

console.log('🔄 Menghubungkan ke server pusat...');

const socket = io(VPS_URL, {
    auth: { token: AUTH_TOKEN },
    reconnection: true,             // Otomatis reconnect jika sinyal putus
    reconnectionAttempts: Infinity, // Coba terus sampai nyambung
    reconnectionDelay: 1000
});

// Event saat berhasil terhubung
socket.on('connect', () => {
    console.log(' BERHASIL TERHUBUNG KE SERVER PUSAT!');
    console.log(' Menunggu link masuk...');
});

// Event saat koneksi gagal (misal token salah)
socket.on('connect_error', (err) => {
    console.log(' Gagal terhubung:', err.message);
});

// Event saat terputus dari server
socket.on('disconnect', () => {
    console.log(' Terputus dari server pusat. Mencoba menyambung kembali...');
});

// ================= EKSEKUSI LINK =================
// Mendengarkan instruksi 'eksekusi_link' dari VPS
socket.on('eksekusi_link', (data) => {
    const sumber = data.sumber === '120363408426078537@g.us' ? 'Grup Utama' : 'Grup Kedua';
    console.log(` [Instruksi dari Server | ${sumber}] Mengeksekusi: ${data.link}`);
    
    // Buka link menggunakan sistem Android
    spawn('termux-open-url', [data.link], { detached: true, stdio: 'ignore' }).unref();
});