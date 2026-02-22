const { default: makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const express = require('express');

// --- CONFIGURACIÓN DE RED ---
const app = express();
const PORT = process.env.PORT || 8080;
app.get('/', (req, res) => res.send('Maxor Bot: Sistema QR Activo 🦷'));
app.listen(PORT, '0.0.0.0', () => console.log(`🌍 Servidor en puerto ${PORT}`));

// --- CONFIGURACIÓN DE APIS ---
const GROQ_API_KEY = "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";

async function startBot() {
    // Usamos una carpeta de sesión nueva para limpiar errores previos
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_v3');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        // CAMBIO: Usamos Chrome en Windows para que el QR sea más compatible con IPs de VPS
        browser: ["Windows", "Chrome", "110.0.0"], 
        printQRInTerminal: true, // ESTO MOSTRARÁ EL QR EN TU CONSOLA DE GOOGLE CLOUD
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000
    });

    // Guardar credenciales automáticamente
    sock.ev.on('creds.update', saveCreds);

    // --- MANEJO DE CONEXIÓN Y QR ---
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("\n📢 ¡QR GENERADO! Escanéalo rápidamente desde tu WhatsApp:");
            console.log("Nota: Si el QR se ve mal, agranda la ventana de la terminal.\n");
        }

        if (connection === 'open') {
            console.log('✅ ¡MAXOR CONECTADO EXITOSAMENTE! 🦷🤵‍♂️');
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`⚠️ Conexión cerrada (${statusCode}). Reintentando en 15s...`);
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => startBot(), 15000);
            }
        }
    });

    // --- LÓGICA DE MENSAJES (IA) ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const chatId = msg.key.remoteJid;
        if (chatId.endsWith('@g.us')) return;

        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        const systemPrompt = `Eres Maxor, el asistente virtual de la Clínica Dental Maxor en Caracas.`;

        if (text) {
            try {
                await sock.sendPresenceUpdate('composing', chatId);
                
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: systemPrompt }, 
                        { role: "user", content: text }
                    ]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` } });

                let respuestaIA = res.data.choices[0].message.content;
                await sock.sendMessage(chatId, { text: respuestaIA });
            } catch (e) { 
                console.error("Error en IA:", e.message); 
            }
        }
    });
}

startBot();
