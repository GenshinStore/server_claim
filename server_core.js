const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

// ================= KONFIGURASI PENTING =================
const PORT = 3000;
const VPS_URL = 'http://72.61.116.57:3000'; // Sesuai IP VPS Anda

// GANTI DENGAN NOMOR WA MAS TRIO (Format: 628xxx@s.whatsapp.net)
// Nomor ini yang diberi kuasa mengeksekusi perintah di Grup Admin
const NOMOR_ADMIN = '158458624090312@lid@s.whatsapp.net'; 

// Grup Manajemen (Tempat Bot merespons !add, !mode, !info)
const GRUP_ADMIN = '120363429956751358@g.us'; 

// Grup Target Pantauan Link
const GRUP_UTAMA = '120363408426078537@g.us';
const GRUP_KEDUA = '120363426296094605@g.us';

let DUAL_MODE = false; // Bawaan awal: False (Hanya pantau Grup Utama)

// ================= DATABASE CLIENT ID =================
const DB_FILE = './authorized_ids.json';
let authorizedIDs = new Set();

// Load ID yang sudah terdaftar agar tidak hilang saat VPS restart
if (fs.existsSync(DB_FILE)) {
    try {
        authorizedIDs = new Set(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
    } catch (e) {
        console.log('Database baru dibuat.');
    }
}
const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify([...authorizedIDs]));

// ================= SERVER & SOCKET (OPTIMASI SUPER CEPAT) =================
const app = express();
const server = http.createServer(app);

// Optimasi: transports ['websocket'] menonaktifkan HTTP Polling yang lambat
// perMessageDeflate: false menonaktifkan kompresi agar delay berkurang
const io = new Server(server, { 
    transports: ['websocket'], 
    perMessageDeflate: false 
});

// Route Distribusi Script File-less (curl | node)
app.get('/run', (req, res) => {
    res.setHeader('Content-Type', 'text/javascript');
    try {
        const clientScript = fs.readFileSync(__dirname + '/client_core.js', 'utf8');
        res.send(clientScript);
    } catch (error) {
        res.status(500).send('console.log("❌ ERROR: File client.js tidak ditemukan di server VPS.");');
    }
});

// Middleware Keamanan Socket.IO
io.use((socket, next) => {
    const clientID = socket.handshake.auth.id;
    if (authorizedIDs.has(clientID)) return next();
    return next(new Error('UNAUTHORIZED'));
});

io.on('connection', (socket) => {
    console.log(`[+] Klien Termux Terhubung: ${socket.handshake.auth.id}`);
    socket.on('disconnect', () => {
        console.log(`[-] Klien Termux Terputus: ${socket.handshake.auth.id}`);
    });
});

// ================= BOT WHATSAPP BAILEYS =================
const linkRegex = /(https?:\/\/)?([\w-]+\.)?(dana\.id|link\.dana\.id|gopay\.co\.id|app\.gopay\.co\.id|shopeepay\.co\.id|shopee\.co\.id\/universal-link)(\/[^\s]*)?/gi;

// Cache menggunakan Set agar pencarian (lookup) O(1) sangat cepat
const activeLinks = new Set();

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }), // Matikan log bawaan agar tidak membebani CPU
        browser: ['ServerClaim', 'Chrome', '1.0.0'],
        getMessage: async () => ({ conversation: '' }) // Optimasi memori
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        
        if (connection === 'open') {
            console.log('✅ BOT WA READY & MEMANTAU GRUP!');
        } else if (connection === 'close') {
            console.log('🔄 Koneksi WA terputus, menyambung ulang...');
            setTimeout(startBot, 3000); // Auto reconnect jika WA putus
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid; 
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!text) return;

        // --- 1. FITUR DEBUGGING (Cek di PM2 Logs) ---
        console.log(`\n[DEBUG LOG] Pesan diterima!`);
        console.log(`- Dari Group/Chat : ${from}`);
        console.log(`- Pengirim Asli   : ${sender}`);
        console.log(`- Teks            : ${text}`);

        // --- 2. PEMBERSIHAN NOMOR SENDER ---
        // Menghapus ID Perangkat (contoh: 628123:5@s.whatsapp.net menjadi 628123@s.whatsapp.net)
        const cleanSender = sender.split(':')[0] + '@s.whatsapp.net';

        // ================= PERINTAH ADMIN DI GRUP ADMIN =================
        // Sekarang kita cocokan cleanSender dengan NOMOR_ADMIN
        if (from === GRUP_ADMIN && cleanSender === NOMOR_ADMIN && text.startsWith('!')) {
            console.log(`[+] PERINTAH ADMIN TERDETEKSI: ${text}`);
            
            const args = text.trim().split(' ');
            const command = args[0].toLowerCase();

            if (command === '!add' && args[1]) {
                const newId = args[1];
                authorizedIDs.add(newId);
                saveDB();
                
                // 1. Kirim pesan pembuka & instruksi (membalas pesan admin)
                const textPembuka = `✅ *ID ${newId} BERHASIL DIDAFTARKAN*\n\nJalankan perintah berikut satu persatu di termux:`;
                await sock.sendMessage(from, { text: textPembuka }, { quoted: msg });

                // 2. Kirim perintah satu per satu secara berurutan
                // Sengaja menggunakan backtick (`) agar teks menjadi monospace, 
                // sehingga di WA cukup ditekan lama akan otomatis tersalin.
                await sock.sendMessage(from, { text: `\`pkg update && pkg install nodejs -y\`` });
                await sock.sendMessage(from, { text: `\`npm install socket.io-client\`` });
                await sock.sendMessage(from, { text: `\`termux-wake-lock\`` });
                await sock.sendMessage(from, { text: `\`curl -sL ${VPS_URL}/run | node - ${newId}\`` });
                
                return;
            }

            if (command === '!mode') {
                const modeVal = args[1];
                if (modeVal === 'true') {
                    DUAL_MODE = true;
                    await sock.sendMessage(from, { text: '⚡ Mode Super Cepat: MEMANTAU 2 GRUP' }, { quoted: msg });
                } else if (modeVal === 'false') {
                    DUAL_MODE = false;
                    await sock.sendMessage(from, { text: '🛑 Mode Single: MEMANTAU GRUP UTAMA SAJA' }, { quoted: msg });
                }
                return;
            }

            if (command === '!info') {
                const infoText = `🤖 *MENU ADMIN CLAIMER*\n\n*!add <ID>* : Mendaftarkan ID klien baru.\n*!mode true* : Pantau Grup Utama & Kedua.\n*!mode false* : Pantau Grup Utama saja.\n\n_Status Mode Dual saat ini:_ *${DUAL_MODE}*`;
                await sock.sendMessage(from, { text: infoText });
                return;
            }
        }


        // ================= EKSEKUSI LINK SUPER CEPAT =================
        const isGrupUtama = (from === GRUP_UTAMA);
        const isGrupKedua = (from === GRUP_KEDUA);

        // Filter Grup (Jika bukan grup target, langsung hentikan proses agar hemat CPU)
        if (DUAL_MODE) {
            if (!isGrupUtama && !isGrupKedua) return;
        } else {
            if (!isGrupUtama) return;
        }

        // Eksekusi regex kilat
        const matches = text.match(linkRegex);
        if (!matches) return;

        // Looping cepat tanpa blocking/await
        for (let i = 0; i < matches.length; i++) {
            let link = matches[i].startsWith('http') ? matches[i] : 'https://' + matches[i];

            if (!activeLinks.has(link)) {
                activeLinks.add(link);
                // Hapus cache link setelah 5 detik agar memori tidak penuh
                setTimeout(() => activeLinks.delete(link), 5000); 

                const sumberName = isGrupUtama ? 'Grup Utama' : 'Grup Kedua';
                console.log(`🚀 BROADCAST KILAT -> ${link} (${sumberName})`);
                
                // MENGIRIM LINK KE SELURUH KLIEN TERMUX SECARA BERSAMAAN
                io.emit('eksekusi_link', { link: link, sumber: sumberName });
            }
        }
    });
}

// Jalankan Server Web dan Bot secara bersamaan
server.listen(PORT, () => {
    console.log(`🚀 Server Engine berjalan di port ${PORT}`);
    startBot();
});