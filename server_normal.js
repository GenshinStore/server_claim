const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

// ================= KONFIGURASI SERVER =================
const PORT = 3001; // MENGGUNAKAN PORT 3001 AGAR TIDAK BENTROK DENGAN BOT UTAMA
const AUTH_TOKEN = 'TOKEN_KHUSUS_PELANGGAN_123'; 

const app = express();
const server = http.createServer(app);
const io = new Server(server);

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (token === AUTH_TOKEN) return next();
    return next(new Error('Token tidak valid!'));
});

// Rute khusus untuk pelanggan (File-less execution)
app.get('/run-normal', (req, res) => {
    res.setHeader('Content-Type', 'text/javascript');
    try {
        const clientScript = fs.readFileSync(__dirname + '/client_normal.js', 'utf8');
        res.send(clientScript);
    } catch (error) {
        res.status(500).send('console.log("Error: Script client_normal.js tidak ditemukan.");');
    }
});

io.on('connection', (socket) => {
    console.log(`[PELANGGAN] Terhubung: ${socket.id}`);
    socket.on('disconnect', () => console.log(`[PELANGGAN] Terputus: ${socket.id}`));
});

// ================= KONFIGURASI BOT WA =================
const GRUP_TARGET = '120363426296094605@g.us'; // MENGUNCI HANYA DI GRUP INI
const linkRegex = /(https?:\/\/)?([\w-]+\.)?(dana\.id|link\.dana\.id|gopay\.co\.id|app\.gopay\.co\.id|shopeepay\.co\.id|shopee\.co\.id\/universal-link)(\/[^\s]*)?/gi;

const activeLinks = new Set();

async function startBot() {
    // Membuat folder session baru khusus untuk bot pelanggan
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_normal');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['BotPelanggan', 'Chrome', '1.0.0'],
        getMessage: async () => ({ conversation: '' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        
        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            if (reason !== 401) {
                console.log(' Reconnecting Bot Pelanggan...');
                setTimeout(startBot, 3000);
            } else {
                console.log(' Sesi invalid. Hapus folder auth_info_normal.');
            }
        } else if (connection === 'open') {
            console.log(' BOT PELANGGAN READY!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        
        // HANYA MEMPROSES PESAN JIKA BERASAL DARI GRUP TARGET
        if (from !== GRUP_TARGET) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!text) return;

        const matches = text.match(linkRegex);
        if (!matches) return;

        for (let link of matches) {
            link = link.startsWith('http') ? link : 'https://' + link;

            if (!activeLinks.has(link)) {
                activeLinks.add(link);
                setTimeout(() => activeLinks.delete(link), 10000);

                console.log(`📡 BROADCAST KE PELANGGAN: ${link}`);
                io.emit('eksekusi_link', { link: link });
            }
        }
    });
}

server.listen(PORT, () => {
    console.log(` Server Pelanggan berjalan di port ${PORT}`);
    startBot();
});