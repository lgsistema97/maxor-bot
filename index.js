const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason, Browsers } = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 8080; // Ajustado al puerto que muestra tu log de Railway

app.get('/', (req, res) => res.send('Maxor Bot Status: Online 🦷'));
app.listen(PORT, '0.0.0.0', () => console.log(`🌍 Servidor en puerto ${PORT}`));

const GROQ_API_KEY = "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";
const GOOGLE_TTS_API_KEY = "AIzaSyA9twZINwlgQ1s9w-brp9XS00cdl_EbF9U";

async function startBot() {
    // 1. IMPORTANTE: Usamos un nombre de sesión nuevo para forzar limpieza
    const { state, saveCreds } = await useMultiFileAuthState('sesion_nueva_maxor');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        // 2. CAMBIO CLAVE: Usamos Browsers.appropriate para que Baileys elija una identidad válida
        browser: Browsers.macOS('Desktop'), 
        syncFullHistory: false,
        linkPreviewImageThumbnailWidth: 192,
        // 3. TIEMPOS DE ESPERA: Evita que WhatsApp cierre por "timeout"
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
        generateHighQualityLinkPreview: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("\n⚠️ COPIA ESTE ENLACE AHORA:");
            console.log("https://api.qrserver.com/v1/create-qr-code/?data=" + encodeURIComponent(qr));
            console.log("⚠️ ESCANEA ANTES DE QUE EXPIRE\n");
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            // Si el error es 405 (Method Not Allowed), esperamos más tiempo antes de reintentar
            const delay = code === 405 ? 30000 : 10000;
            console.log(`❌ Error ${code}. Reintentando en ${delay/1000}s...`);
            setTimeout(() => startBot(), delay);
        }

        if (connection === 'open') console.log('✅ MAXOR CONECTADO EXITOSAMENTE');
    });

    // Tu lógica de mensajes (Grok + Google TTS) se mantiene igual debajo...
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const chatId = msg.key.remoteJid;
        if (chatId.endsWith('@g.us')) return;

        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "system", content: "Eres Maxor..." }, { role: "user", content: text }]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` } });
                await sock.sendMessage(chatId, { text: res.data.choices[0].message.content });
            } catch (e) { console.log("Error:", e.message); }
        }
    });
}

startBot();
