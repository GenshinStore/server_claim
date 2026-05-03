const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

// ================= KONFIGURASI SERVER & KEAMANAN =================
const PORT = 3000; // Port VPS yang akan digunakan
const AUTH_TOKEN = 'q7t0Ag#sN)hZxyMx'; // Ganti dengan password rahasia Anda. Klien butuh ini untuk konek.

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware Socket.io untuk mengecek Token Klien
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (token === AUTH_TOKEN) {
        return next();
    }
    return next(new Error('Authentication error: Token tidak valid!'));
});

io.on('connection', (socket) => {
    console.log(` Klien terhubung: ${socket.id}`);
    socket.on('disconnect', () => console.log(` Klien terputus: ${socket.id}`));
});

// ================= KONFIGURASI BOT WA =================
const GRUP_UTAMA = '120363408426078537@g.us';
const GRUP_KEDUA = '120363426296094605@g.us';
const TARGET_GROUP_IDS = new Set([GRUP_UTAMA, GRUP_KEDUA]);

const linkRegex = /(https?:\/\/)?([\w-]+\.)?(dana\.id|link\.dana\.id|gopay\.co\.id|app\.gopay\.co\.id|shopeepay\.co\.id|shopee\.co\.id\/universal-link)(\/[^\s]*)?/gi;

// Cache real-time agar server tidak membombardir klien dengan link duplikat
const activeLinks = new Set();
const CACHE_TTL = 10000;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['BotVPS', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60000,
        getMessage: async () => ({ conversation: '' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        
        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            if (reason !== 401) {
                console.log('🔄 Reconnecting...');
                setTimeout(startBot, 3000);
            } else {
                console.log(' Sesi tidak valid. Hapus folder auth_info_baileys.');
            }
        } else if (connection === 'open') {
            console.log(' BOT WA READY DI VPS!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        if (!TARGET_GROUP_IDS.has(from)) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!text) return;

        const bodyLower = text.toLowerCase();
        if (!bodyLower.includes('dana') && !bodyLower.includes('gopay') && !bodyLower.includes('shopee')) return;

        const matches = text.match(linkRegex);
        if (!matches) return;

        for (let i = 0; i < matches.length; i++) {
            let link = matches[i].startsWith('http') ? matches[i] : 'https://' + matches[i];

            if (!activeLinks.has(link)) {
                activeLinks.add(link);
                setTimeout(() => activeLinks.delete(link), CACHE_TTL);

                console.log(`📡 BROADCAST KE KLIEN [${from === GRUP_UTAMA ? 'Grup 1' : 'Grup 2'}]: ${link}`);
                
                // MENGIRIM LINK KE SEMUA TERMUX KLIEN YANG TERHUBUNG
                io.emit('eksekusi_link', { link: link, sumber: from });
            }
        }
    });
}

// Jalankan server di VPS
server.listen(PORT, () => {
    console.log(` WebSocket Server berjalan di port ${PORT}`);
    startBot();
});