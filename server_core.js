const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

// ================= KONFIGURASI =================
const PORT = 3000;
const ADMIN_GROUP = '123456789012345678@g.us'; // Ganti dengan ID Grup Admin Anda
const GRUP_UTAMA = '120363408426078537@g.us';
const GRUP_KEDUA = '120363426296094605@g.us';

let DUAL_MODE = false; // Mode default: false (hanya Grup Utama)

// Database Client ID sederhana
const DB_FILE = './authorized_ids.json';
let authorizedIDs = new Set();
if (fs.existsSync(DB_FILE)) {
    authorizedIDs = new Set(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
}

const saveDB = () => fs.writeFileSync(DB_FILE, JSON.stringify([...authorizedIDs]));

// ================= SETUP SOCKET.IO =================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    transports: ['websocket'], // Optimasi super cepat: Lewati HTTP Polling
    perMessageDeflate: false   // Matikan kompresi agar latensi milidetik tidak terhambat
});

// Middleware Keamanan Berbasis ID
io.use((socket, next) => {
    const clientID = socket.handshake.auth.id;
    if (authorizedIDs.has(clientID)) {
        return next();
    }
    return next(new Error('UNAUTHORIZED'));
});

io.on('connection', (socket) => {
    const cid = socket.handshake.auth.id;
    console.log(`[+] Klien Sah Terhubung: ${cid} (Socket: ${socket.id})`);
    socket.on('disconnect', () => console.log(`[-] Klien Terputus: ${cid}`));
});

// ================= SETUP BOT WHATSAPP =================
const linkRegex = /(https?:\/\/)?([\w-]+\.)?(dana\.id|link\.dana\.id|gopay\.co\.id|app\.gopay\.co\.id|shopeepay\.co\.id|shopee\.co\.id\/universal-link)(\/[^\s]*)?/gi;
const activeLinks = new Set();

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['ServerBot', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === 'open') console.log('✅ BOT WA READY & MEMANTAU GRUP!');
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!text) return;

        // --- FITUR ADMIN COMMANDS (DI GRUP ADMIN) ---
        if (from === ADMIN_GROUP) {
            const args = text.trim().split(' ');
            const command = args[0].toLowerCase();

            if (command === '!add' && args[1]) {
                const newId = args[1];
                authorizedIDs.add(newId);
                saveDB();
                
                const replyTeks = `✅ *Akses Diberikan untuk ID:* ${newId}\n\nKirimkan panduan ini ke client. (Bisa di-tap untuk copy):\n\n\`pkg update && pkg upgrade -y\`\n\n\`pkg install nodejs -y\`\n\n\`npm install socket.io-client\`\n\n\`termux-wake-lock\`\n\n\`node client.js\``;
                await sock.sendMessage(from, { text: replyTeks });
                return;
            }

            if (command === '!mode') {
                const modeVal = args[1];
                if (modeVal === 'true') {
                    DUAL_MODE = true;
                    await sock.sendMessage(from, { text: '⚡ Mode Super Cepat Aktif: Memantau KEDUA Grup.' });
                } else if (modeVal === 'false') {
                    DUAL_MODE = false;
                    await sock.sendMessage(from, { text: '🛑 Mode Single Aktif: Memantau HANYA Grup Utama.' });
                }
                return;
            }
        }

        // --- FILTERING GRUP TARGET ---
        const isGrupUtama = (from === GRUP_UTAMA);
        const isGrupKedua = (from === GRUP_KEDUA);

        if (DUAL_MODE) {
            if (!isGrupUtama && !isGrupKedua) return;
        } else {
            if (!isGrupUtama) return;
        }

        // --- EKSEKUSI LINK SUPER CEPAT ---
        const matches = text.match(linkRegex);
        if (!matches) return;

        // Gunakan perulangan tanpa blocking
        for (let i = 0; i < matches.length; i++) {
            let link = matches[i].startsWith('http') ? matches[i] : 'https://' + matches[i];

            if (!activeLinks.has(link)) {
                activeLinks.add(link);
                setTimeout(() => activeLinks.delete(link), 8000); // Bersihkan cache lebih cepat

                console.log(`🚀 BROADCAST CEPAT -> ${link}`);
                // Emit secepat kilat ke semua client authorized
                io.emit('eksekusi_link', link);
            }
        }
    });
}

server.listen(PORT, () => {
    console.log(`🚀 Server Command & Control berjalan di port ${PORT}`);
    startBot();
});