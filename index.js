const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const { createClient } = require('@supabase/supabase-js');
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- CONFIGURACIÓN DE BASE DE DATOS ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// --- SERVIDOR WEB (Evita el error de puerto ocupado) ---
const app = express();
app.get('/', (req, res) => res.send('Maxor Bot Activo 🦷🤵‍♂️'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌍 Servidor web en puerto ${PORT}`));

// --- CONFIGURACIÓN DE APIS ---
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY;

async function startBot() {
    // Usamos una carpeta específica para la sesión
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_v1');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Maxor AI", "Chrome", "20.0.04"],
        connectTimeoutMs: 60000,      // 60 segundos de espera inicial
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000    // Mantiene la conexión activa cada 10 seg
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log("************************************************");
            console.log("👇 ¡NUEVO CÓDIGO QR GENERADO! 👇");
            console.log("https://api.qrserver.com/v1/create-qr-code/?data=" + encodeURIComponent(qr));
            console.log("************************************************");
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const debeReintentar = statusCode !== DisconnectReason.loggedOut;
            
            console.log(`⚠️ Conexión cerrada (Código: ${statusCode}). Reintentando en 5s: ${debeReintentar}`);
            
            // Si no es un cierre por "Cerrar sesión", reintenta tras 5 segundos
            if (debeReintentar) {
                setTimeout(() => startBot(), 5000);
            }
        }
        
        if (connection === 'open') {
            console.log('✅✅✅ MAXOR CONECTADO EXITOSAMENTE ✅✅✅');
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

        if (text || esAudio) {
            try {
                // (Aquí va tu lógica de Whisper, Llama y Google TTS que ya teníamos)
                console.log(`📩 Mensaje recibido de ${chatId}`);
            } catch (e) {
                console.error("Error procesando mensaje:", e.message);
            }
        }
    });
}

// Arrancamos el bot
startBot();
