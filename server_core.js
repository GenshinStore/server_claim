const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const { performance } = require('perf_hooks');

// ================= KONFIGURASI PENTING =================
const PORT = 3000;
const VPS_URL = 'http://72.61.116.57:3000';

// HAK AKSES SISTEM
const MAIN_ADMIN = '158458624090312'; // Akan dicocokkan menggunakan .includes() untuk mengabaikan @lid / @s.whatsapp.net
const DEFAULT_ADMIN_GROUP = '120363429956751358@g.us';
const DEFAULT_CLAIM_GROUP = '120363408426078537@g.us';

// ================= DATABASE & STATE MANAGEMENT =================
const DB_CLIENTS = './authorized_ids.json';
const DB_CONFIG = './system_config.json';

let authorizedIDs = new Set();
let sysConfig = {
    adminGroups: [DEFAULT_ADMIN_GROUP],
    claimGroups: [DEFAULT_CLAIM_GROUP],
    mode: 'all', // 'all' atau 'priority'
    priorityGroup: null
};

// Statistik Realtime
let stats = {
    msgMasuk: 0,
    fwBerhasil: 0,
    fwDuplicate: 0,
    startTime: Date.now()
};

// State Approval ReqBot
let pendingReqBot = null;

// Load DB Client
if (fs.existsSync(DB_CLIENTS)) {
    try { authorizedIDs = new Set(JSON.parse(fs.readFileSync(DB_CLIENTS, 'utf8'))); }
    catch (e) { console.log('DB Client Error, membuat ulang...'); }
}
const saveDBClients = () => fs.writeFileSync(DB_CLIENTS, JSON.stringify([...authorizedIDs]));

// Load System Config (Grup & Mode)
if (fs.existsSync(DB_CONFIG)) {
    try {
        const parsed = JSON.parse(fs.readFileSync(DB_CONFIG, 'utf8'));
        sysConfig = { ...sysConfig, ...parsed }; // Merge default dengan saved
    }
    catch (e) { console.log('DB Config Error, membuat ulang...'); }
}
const saveConfig = () => fs.writeFileSync(DB_CONFIG, JSON.stringify(sysConfig, null, 2));

// ================= SERVER & SOCKET (OPTIMASI SUPER CEPAT) =================
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    transports: ['websocket'],
    perMessageDeflate: false
});

app.get('/run', (req, res) => {
    res.setHeader('Content-Type', 'text/javascript');
    try {
        const clientScript = fs.readFileSync(__dirname + '/client_core.js', 'utf8');
        res.send(clientScript);
    } catch (error) {
        res.status(500).send('console.log("❌ ERROR: File client_core.js tidak ditemukan.");');
    }
});

io.use((socket, next) => {
    const clientID = socket.handshake.auth.id;
    if (authorizedIDs.has(clientID)) return next();
    return next(new Error('UNAUTHORIZED'));
});

io.on('connection', (socket) => {
    console.log(`[+] Klien Claimer Terhubung: ${socket.handshake.auth.id}`);
    socket.on('disconnect', () => console.log(`[-] Klien Claimer Terputus: ${socket.handshake.auth.id}`));
});

// ================= BOT WHATSAPP BAILEYS =================
const linkRegex = /(https?:\/\/)?([\w-]+\.)?(dana\.id|link\.dana\.id|gopay\.co\.id|app\.gopay\.co\.id|shopeepay\.co\.id|shopee\.co\.id\/universal-link)(\/[^\s]*)?/gi;
const activeLinks = new Set(); // Cache Memory Kilat

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['ServerClaim', 'Chrome', '2.0.0'],
        getMessage: async () => ({ conversation: '' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === 'open') console.log('✅ BOT SYSTEM ONLINE & READY!');
        else if (connection === 'close') setTimeout(startBot, 3000);
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        stats.msgMasuk++;
        const from = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        if (!text) return;

        const isMainAdmin = sender.includes(MAIN_ADMIN);
        const isDefaultAdminGroup = (from === DEFAULT_ADMIN_GROUP);
        const isAdminGroup = sysConfig.adminGroups.includes(from);

        // ================= SISTEM APPROVAL REQBOT =================
        if (isMainAdmin && pendingReqBot) {
            const upperText = text.trim().toUpperCase();
            if (upperText === 'OKE' || upperText === 'IYA') {
                authorizedIDs.add(pendingReqBot.id);
                saveDBClients();

                // Pesan Tutorial saat ReqBot di-ACC
                const tutorialAcc = `✅ *REQUEST DISETUJUI & ID BERHASIL DIDAFTARKAN!*
ID Perangkat: *${pendingReqBot.id}*

*TUTORIAL MENJALANKAN CLIENT:*
1. *Download Termux*
https://f-droid.org/repo/com.termux_1022.apk

2. *Install NodeJS* (Salin & tempel di Termux)
\`pkg update && pkg install nodejs -y\`

3. *Install Socket.IO Client*
\`npm install socket.io-client\`

4. *Aktifkan Wake Lock* (Agar tidak sleep)
\`termux-wake-lock\`

5. *Jalankan Client*
\`curl -sL ${VPS_URL}/run | node - ${pendingReqBot.id}\`

6. *Download Script MacroDroid*
https://drive.google.com/file/d/1-8BAkexUapLo4VZ6kMU2OOLXyhh-3rVd/view?usp=sharing

*SELESAI!* 🚀`;

                await sock.sendMessage(pendingReqBot.group, { text: tutorialAcc });
                pendingReqBot = null;
                return;
            } else if (upperText === 'TIDAK') {
                await sock.sendMessage(pendingReqBot.group, { text: `❌ *REQUEST DITOLAK*\nID ${pendingReqBot.id} tidak diizinkan oleh Main Admin.` });
                pendingReqBot = null;
                return;
            }
        }

        // ================= COMMAND ADMIN =================
        if (isAdminGroup && text.startsWith('!')) {
            const args = text.trim().split(' ');
            const command = args[0].toLowerCase();
            const startPing = performance.now();

            // Hak Akses Khusus: Main Admin & Default Admin Group
            if (isMainAdmin || isDefaultAdminGroup) {
                if (command === '!addgrupadmin' && args[1]) {
                    sysConfig.adminGroups.push(args[1]);
                    sysConfig.adminGroups = [...new Set(sysConfig.adminGroups)];
                    saveConfig();
                    return sock.sendMessage(from, { text: `✅ Grup Admin ditambahkan:\n${args[1]}` });
                }
                if (command === '!delgrupadmin' && args[1]) {
                    sysConfig.adminGroups = sysConfig.adminGroups.filter(g => g !== args[1]);
                    saveConfig();
                    return sock.sendMessage(from, { text: `🗑️ Grup Admin dihapus:\n${args[1]}` });
                }
                if (command === '!addgrupclaim' && args[1]) {
                    sysConfig.claimGroups.push(args[1]);
                    sysConfig.claimGroups = [...new Set(sysConfig.claimGroups)];
                    saveConfig();
                    return sock.sendMessage(from, { text: `✅ Grup Claim ditambahkan:\n${args[1]}` });
                }
                if (command === '!delgrupclaim' && args[1]) {
                    sysConfig.claimGroups = sysConfig.claimGroups.filter(g => g !== args[1]);
                    saveConfig();
                    return sock.sendMessage(from, { text: `🗑️ Grup Claim dihapus:\n${args[1]}` });
                }
                if (command === '!mode') {
                    if (args[1] === 'true') {
                        sysConfig.mode = 'all';
                        sysConfig.priorityGroup = null;
                        saveConfig();
                        return sock.sendMessage(from, { text: `⚡ Mode Semua Grup: AKTIF\nMemonitor semua grup claim.` });
                    } else if (args[1] === 'false' && args[2]) {
                        sysConfig.mode = 'priority';
                        sysConfig.priorityGroup = args[2];
                        saveConfig();
                        return sock.sendMessage(from, { text: `🎯 Mode Prioritas: AKTIF\nFokus monitoring hanya pada:\n${args[2]}` });
                    }
                }
                // !add langsung jika dari Default Admin / Main Admin
                if (command === '!add' && args[1]) {
                    const newId = args[1];
                    authorizedIDs.add(newId);
                    saveDBClients();

                    // Pesan Tutorial saat pakai perintah !add
                    const tutorialAdd = `✅ *ID ${newId} BERHASIL DITAMBAHKAN!*

*TUTORIAL MENJALANKAN CLIENT:*
1. *Download Termux*
https://f-droid.org/repo/com.termux_1022.apk

2. *Install NodeJS* (Salin teks dalam kotak & tempel di Termux)
\`pkg update && pkg install nodejs -y\`

3. *Install Socket.IO Client*
\`npm install socket.io-client\`

4. *Aktifkan Wake Lock* (Agar tidak sleep)
\`termux-wake-lock\`

5. *Jalankan Client*
\`curl -sL ${VPS_URL}/run | node - ${newId}\`

6. *Download Script MacroDroid*
https://drive.google.com/file/d/1-8BAkexUapLo4VZ6kMU2OOLXyhh-3rVd/view?usp=sharing

*SELESAI!* 🚀`;

                    return sock.sendMessage(from, { text: tutorialAdd });
                }

                // ================= FITUR BARU: HAPUS BOT ID =================
                if (command === '!delbot' && args[1]) {
                    const targetId = args[1];
                    if (authorizedIDs.has(targetId)) {
                        authorizedIDs.delete(targetId);
                        saveDBClients();

                        // Force Disconnect Klien yang sedang online secara Realtime
                        io.sockets.sockets.forEach((clientSocket) => {
                            if (clientSocket.handshake.auth.id === targetId) {
                                clientSocket.disconnect(true);
                            }
                        });

                        return sock.sendMessage(from, { text: `🗑️ ✅ ID Bot *${targetId}* berhasil dihapus dari sistem.\nKlien Termux dengan ID tersebut telah diputus dari server.` });
                    } else {
                        return sock.sendMessage(from, { text: `⚠️ GAGAL: ID Bot *${targetId}* tidak ditemukan di dalam database.` });
                    }
                }
                // ==========================================================
            }

            // Command Umum Grup Admin (Termasuk Admin Tambahan)
            if (command === '!reqbot' && args[1]) {
                pendingReqBot = { id: args[1], group: from, sender: sender };
                return sock.sendMessage(from, { text: `⏳ *REQUEST TERKIRIM*\nMenunggu persetujuan Main Admin untuk ID: ${args[1]}\n(Main Admin: Balas OKE/IYA untuk menyetujui, TIDAK untuk menolak).` });
            }

            // ================= 1. MENU PERINTAH =================
            if (command === '!menu') {
                let menuTxt = `🤖 *MENU BANTUAN ADMIN* 🤖\n\n`;

                menuTxt += `👑 *HAK AKSES UTAMA (Main/Default Admin):*\n`;
                menuTxt += `*!add <ID>* : Tambah ID klien langsung\n`;
                menuTxt += `*!delbot <ID>* : Hapus ID & paksa disconnect\n`;
                menuTxt += `*!addgrupadmin <ID>* : Tambah grup admin\n`;
                menuTxt += `*!delgrupadmin <ID>* : Hapus grup admin\n`;
                menuTxt += `*!addgrupclaim <ID>* : Tambah grup pantauan\n`;
                menuTxt += `*!delgrupclaim <ID>* : Hapus grup pantauan\n`;
                menuTxt += `*!mode true* : Pantau SEMUA grup claim\n`;
                menuTxt += `*!mode false <ID>* : Prioritas SATU grup claim\n\n`;

                menuTxt += `👥 *HAK AKSES UMUM (Semua Admin):*\n`;
                menuTxt += `*!reqbot <ID>* : Request ID (butuh ACC Main Admin)\n`;
                menuTxt += `*!info* : Cek status & konfigurasi server\n`;
                menuTxt += `*!stats* : Cek statistik pesan & duplikat\n`;
                menuTxt += `*!ping* : Cek status & delay server`;

                return sock.sendMessage(from, { text: menuTxt });
            }

            // ================= 2. INFORMASI SERVER =================
            if (command === '!info') {
                const uptime = ((Date.now() - stats.startTime) / 1000 / 60 / 60).toFixed(2);
                let info = `📊 *INFORMASI SERVER*\n\n`;
                info += `🤖 Bot Online (Clients): *${io.engine.clientsCount} Client*\n`;
                info += `👑 Total Grup Admin: *${sysConfig.adminGroups.length}*\n`;
                info += `📡 Total Grup Claim: *${sysConfig.claimGroups.length}*\n`;
                info += `⚡ Mode Forwarding: *${sysConfig.mode === 'all' ? 'SEMUA GRUP' : 'PRIORITAS'}*\n`;
                if (sysConfig.mode === 'priority') info += `🎯 Target Prioritas: *${sysConfig.priorityGroup}*\n`;
                info += `⏱️ Uptime Server: *${uptime} Jam*\n`;
                info += `🗑️ Status Cache: *${activeLinks.size} item aktif*`;

                return sock.sendMessage(from, { text: info });
            }

            if (command === '!stats') {
                let statText = `📈 *STATISTIK SISTEM*\n\n`;
                statText += `📥 Total Pesan Masuk: *${stats.msgMasuk}*\n`;
                statText += `✅ Total Forward Sukses: *${stats.fwBerhasil}*\n`;
                statText += `🚫 Duplicate Link Terfilter: *${stats.fwDuplicate}*`;
                return sock.sendMessage(from, { text: statText });
            }

            if (command === '!ping') {
                const endPing = performance.now();
                const latency = Math.round(endPing - startPing);
                return sock.sendMessage(from, { text: `🏓 Pong! \nStatus: *🟢 ONLINE*\nDelay Server: *${latency}ms*` });
            }
        }

        // ================= SISTEM FORWARDING & CLAIM LINK =================
        const isClaimGroup = sysConfig.claimGroups.includes(from);

        // Filter Akses Grup Claim berdasarkan Mode
        if (!isClaimGroup) return;
        if (sysConfig.mode === 'priority' && from !== sysConfig.priorityGroup) return;

        // Eksekusi Cepat (Regex)
        const matches = text.match(linkRegex);
        if (!matches) return;

        // Async Parallel Forwarding Queue
        Promise.allSettled(matches.map(async (match) => {
            let link = match.startsWith('http') ? match : 'https://' + match;

            if (!activeLinks.has(link)) {
                activeLinks.add(link);
                stats.fwBerhasil++;

                // Auto Cleanup Memory (Hapus link dari Set setelah 10 detik)
                setTimeout(() => activeLinks.delete(link), 10000);

                console.log(`🚀 FORWARD -> ${link}`);
                io.emit('eksekusi_link', { link: link, sumber: from });
            } else {
                stats.fwDuplicate++; // Tercatat sebagai duplikat / loop terfilter
            }
        }));
    });
}

server.listen(PORT, () => {
    console.log(`🚀 SERVER PUSAT ENGINE V2 Berjalan di Port ${PORT}`);
    startBot();
});

// Auto Restart Memory Cleanup setiap 6 Jam
setInterval(() => {
    console.log('🔄 Memulai Auto-Restart Terjadwal untuk kestabilan...');
    process.exit(1); // PM2 akan otomatis menyalakan ulang
}, 6 * 60 * 60 * 1000);