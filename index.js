const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- SERVIDOR PARA RENDER ---
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Maxor Bot Activo 🦷🤵‍♂️'));
app.listen(PORT, '0.0.0.0', () => console.log(`🌍 Servidor en puerto ${PORT}`));

// --- CONFIGURACIÓN DE APIS ---
const GROQ_API_KEY = "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";
const GOOGLE_TTS_API_KEY = "AIzaSyA9twZINwlgQ1s9w-brp9XS00cdl_EbF9U";

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_caracas_v1');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        // CAMBIO CRÍTICO: Identidad de navegador real para evitar Error 405
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("\n#################################################");
            console.log("🚀 LINK DEL QR:");
            console.log("https://api.qrserver.com/v1/create-qr-code/?data=" + encodeURIComponent(qr));
            console.log("#################################################\n");
        }

        if (connection === 'open') console.log('✅ MAXOR CONECTADO');

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`⚠️ Conexión cerrada (Código: ${statusCode}). Reintentando en 10s...`);
            // El retraso de 10s evita que Render colapse los logs
            setTimeout(() => startBot(), 10000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const chatId = msg.key.remoteJid;
        if (chatId.endsWith('@g.us')) return;

        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        let esAudio = !!msg.message.audioMessage;

        const systemPrompt = `Eres Maxor, el asistente virtual de la Clínica Dental Maxor en Caracas.`;

        if (text || esAudio) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text || "Hola" }]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` } });

                let respuestaIA = res.data.choices[0].message.content;
                await sock.sendMessage(chatId, { text: respuestaIA });
            } catch (e) { console.error("Error:", e.message); }
        }
    });
}
startBot();
