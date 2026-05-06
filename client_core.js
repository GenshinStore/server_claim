const io = require('socket.io-client');
const { spawn } = require('child_process');

// ID didapatkan dari argumen eksekusi (contoh: node - ID123)
const myID = process.argv[2];

if (!myID) {
    console.log('\n❌ ERROR: ID Klien tidak dimasukkan!');
    console.log('Gunakan format: curl -sL http://72.61.116.57:3000/run | node - <ID_ANDA>\n');
    process.exit(1);
}

const VPS_URL = 'http://72.61.116.57:3000';

console.log('===================================');
console.log(`🔑 ID PERANGKAT : ${myID}`);
console.log('===================================');
console.log('Menghubungkan ke server pusat...\n');

const socket = io(VPS_URL, {
    auth: { id: myID },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000
});

socket.on('connect', () => {
    console.log('🟢 BERHASIL TERHUBUNG KE SERVER PUSAT!');
    console.log('⏳ Standby memantau link (Pastikan wake-lock aktif)...');
});

socket.on('connect_error', (err) => {
    if (err.message === 'UNAUTHORIZED') {
        console.log('\n❌ AKSES DITOLAK: ID belum terdaftar!');
        console.log('Hubungi Admin untuk mendaftarkan ID ini.');
        process.exit(1);
    } else {
        console.log('⚠️ Gangguan koneksi:', err.message);
    }
});

socket.on('eksekusi_link', (data) => {
    console.log(`⚡ [${data.sumber}] MENGKLAIM: ${data.link}`);
    
    // Eksekusi super cepat di latar belakang
    const claimProcess = spawn('termux-open-url', [data.link], { 
        detached: true, 
        stdio: 'ignore' 
    });
    claimProcess.unref();
});