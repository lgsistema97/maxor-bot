const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const axios = require("axios");
const qrcode = require("qrcode-terminal");
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot Vivo 🚀'));
app.listen(port, () => console.log(`Puerto activo: ${port}`));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_render');
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ["MaxorBot", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log("📢 ESCANEA ESTE QR:");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log("✅ BOT CONECTADO");
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (text) {
            try {
                await axios.post("https://luisslam.app.n8n.cloud/webhook-test/test-paciente", {
                    nombre: msg.pushName || "Paciente",
                    telefono: msg.key.remoteJid.split('@')[0],
                    mensaje: text
                });
                console.log("🚀 Enviado a n8n");
            } catch (e) { console.log("Error n8n:", e.message); }
        }
    });
}
startBot();
