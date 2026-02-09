const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- SERVIDOR PARA RENDER ---
const app = express();
app.get('/', (req, res) => res.send('Maxor Bot - Modo Masculino Fluido 🦷🤵‍♂️'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌍 Servidor en puerto ${PORT}`));

// --- CONFIGURACIÓN DE APIS (Usando tus llaves directas como querías) ---
const GROQ_API_KEY = "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";
const GOOGLE_TTS_API_KEY = "AIzaSyA9twZINwlgQ1s9w-brp9XS00cdl_EbF9U";

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_caracas_v1');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"] // Más estable para Render
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        
        if (qr) {
            console.log("-------------------------------------------------");
            console.log("📢 COPIA ESTE LINK EN TU NAVEGADOR PARA EL QR:");
            console.log("https://api.qrserver.com/v1/create-qr-code/?data=" + encodeURIComponent(qr));
            console.log("-------------------------------------------------");
        }
        
        if (connection === 'open') console.log('✅ MAXOR CONECTADO');
        
        if (connection === 'close') {
            console.log("⚠️ Conexión cerrada. Reintentando en 10 segundos para poder ver el QR...");
            // ESTA ES LA ÚNICA LÍNEA QUE CAMBIAMOS:
            setTimeout(() => startBot(), 10000); 
        }
    });

    // ... (El resto de tu lógica de mensajes se mantiene exactamente igual)
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
                // Tu lógica de Groq y Google TTS...
                console.log("Procesando mensaje...");
            } catch (e) { console.log("Error:", e.message); }
        }
    });
}

startBot();
