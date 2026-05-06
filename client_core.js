const io = require('socket.io-client');
const { spawn } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

// ================= PENGATURAN KONEKSI =================
const VPS_URL = 'http://IP_VPS_ANDA:3000'; // Ganti dengan IP/Domain VPS Anda

// --- GENERATE ATAU BACA ID CLIENT ---
const ID_FILE = './my_id.txt';
let myID = '';

if (fs.existsSync(ID_FILE)) {
    myID = fs.readFileSync(ID_FILE, 'utf8');
} else {
    // Buat ID unik acak (8 karakter) untuk HP ini
    myID = crypto.randomBytes(4).toString('hex').toUpperCase();
    fs.writeFileSync(ID_FILE, myID);
}

console.log('===================================');
console.log(`🔑 ID PERANGKAT ANDA : ${myID}`);
console.log('===================================');
console.log('Menghubungkan ke server pusat...\n');

// Optimasi transport hanya menggunakan websocket agar latensi < 10ms
const socket = io(VPS_URL, {
    auth: { id: myID },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 3000 // Jangan biarkan jeda reconnect terlalu lama
});

socket.on('connect', () => {
    console.log('🟢 BERHASIL TERHUBUNG KE SERVER PUSAT!');
    console.log('⏳ Standby memantau link (Wake Lock aktif)...');
});

socket.on('connect_error', (err) => {
    if (err.message === 'UNAUTHORIZED') {
        console.log('\n❌ AKSES DITOLAK!');
        console.log(`Silakan kirim ID Perangkat Anda (${myID}) ke Admin untuk didaftarkan.`);
        console.log('Mencoba ulang dalam 3 detik...\n');
    } else {
        console.log('⚠️ Gangguan koneksi:', err.message);
    }
});

socket.on('disconnect', () => {
    console.log('🔴 Terputus dari server. Menyambung ulang...');
});

// ================= EKSEKUSI LINK SUPER CEPAT =================
socket.on('eksekusi_link', (link) => {
    console.log(`⚡ MENGKLAIM: ${link}`);
    
    // Optimasi: Detached true & stdio ignore menghemat penggunaan memory HP jadul
    // Tidak menggunakan 'shell: true' mempercepat eksekusi instruksi ke Android OS
    const claimProcess = spawn('termux-open-url', [link], { 
        detached: true, 
        stdio: 'ignore' 
    });
    
    claimProcess.unref(); // Bebaskan process Node.js dari antrean OS
});