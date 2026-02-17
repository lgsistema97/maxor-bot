const { default: makeWASocket, useMultiFileAuthState, delay, DisconnectReason, downloadContentFromMessage } = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- CONFIGURACIÓN DE RED ---
const app = express();
const PORT = process.env.PORT || 8080;
app.get('/', (req, res) => res.send('Maxor Bot: Sistema de Vinculación Activo 🦷'));
app.listen(PORT, '0.0.0.0', () => console.log(`🌍 Servidor en puerto ${PORT}`));

// --- CONFIGURACIÓN DE APIS Y NÚMERO ---
const MI_NUMERO = "584243835271"; // CAMBIA ESTO: Tu número con código de país (ej. 58 para Venezuela)
const GROQ_API_KEY = "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";
const GOOGLE_TTS_API_KEY = "AIzaSyA9twZINwlgQ1s9w-brp9XS00cdl_EbF9U";

async function startBot() {
    // Usamos una carpeta de sesión limpia para forzar la vinculación
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_v3');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        // Identidad Safari/Mac para evitar que WhatsApp bloquee la IP del servidor
        browser: ["Mac OS", "Safari", "15.0"], 
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000
    });

    // --- PROCESO DE PAIRING CODE ---
    if (!sock.authState.creds.registered) {
        console.log(`\n\n🔗 SOLICITANDO CÓDIGO PARA: ${MI_NUMERO}...`);
        await delay(10000); // Espera extendida para estabilizar la conexión antes de pedir el código
        
        try {
            const code = await sock.requestPairingCode(MI_NUMERO);
            console.log("\n#################################################");
            console.log(`🔥 TU CÓDIGO DE VINCULACIÓN: ${code}`);
            console.log("#################################################\n");
            console.log("Instrucciones:");
            console.log("1. Abre WhatsApp > Dispositivos vinculados.");
            console.log("2. Vincular con el número de teléfono.");
            console.log(`3. Ingresa el código: ${code}\n`);
        } catch (e) {
            console.log("❌ Error al generar código. WhatsApp sigue bloqueando la IP. Reintentando en 30s...");
            setTimeout(() => startBot(), 30000); // Reintento lento para evitar baneo de IP
            return;
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('✅ ¡MAXOR CONECTADO EXITOSAMENTE! 🦷🤵‍♂️');
        }
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`⚠️ Conexión cerrada (${statusCode}). Reintentando...`);
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(() => startBot(), 15000);
            }
        }
    });

    // --- LÓGICA DE MENSAJES (TU CÓDIGO ORIGINAL) ---
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
                // Simulación de escritura
                await sock.sendPresenceUpdate('composing', chatId);
                
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text || "Hola" }]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` } });

                let respuestaIA = res.data.choices[0].message.content;
                await sock.sendMessage(chatId, { text: respuestaIA });
            } catch (e) { console.error("Error en IA:", e.message); }
        }
    });
}

startBot();
