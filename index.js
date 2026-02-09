const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const { createClient } = require('@supabase/supabase-js');
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- 1. RESPUESTA INSTANTÁNEA PARA KOYEB (HEALTH CHECK) ---
const app = express();
app.get('/', (req, res) => res.status(200).send('Maxor Bot Online 🦷'));
app.get('/health', (req, res) => res.status(200).send('OK')); 

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌍 Servidor web activo en puerto ${PORT}`);
});

// --- 2. CONFIGURACIÓN DE BASE DE DATOS ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY;

async function startBot() {
    // Usamos una carpeta de sesión limpia
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_v1');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        // Cambiamos a un navegador más común para evitar bloqueos de IP
        browser: ["Ubuntu", "Chrome", "20.0.04"], 
        connectTimeoutMs: 120000, // 2 minutos de espera
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 30000,
        printQRInTerminal: false 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // --- 3. IMPRESIÓN RESALTADA DEL QR ---
        if (qr) {
            console.log("************************************************");
            console.log("👇 ¡EL LINK DEL QR ESTÁ AQUÍ! 👇");
            console.log("https://api.qrserver.com/v1/create-qr-code/?data=" + encodeURIComponent(qr));
            console.log("************************************************");
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            // Si no fue un cierre voluntario, reintenta tras 10 segundos para no saturar
            const debeReintentar = statusCode !== DisconnectReason.loggedOut;
            
            console.log(`⚠️ Conexión cerrada (Código: ${statusCode}). Reintentando en 10s...`);
            if (debeReintentar) {
                setTimeout(() => startBot(), 10000);
            }
        }
        
        if (connection === 'open') {
            console.log('✅✅✅ ¡MAXOR CONECTADO EXITOSAMENTE! ✅✅✅');
        }
    });

    // Lógica de mensajes (se mantiene igual para no afectar el Dashboard)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const chatId = msg.key.remoteJid;
        if (chatId.endsWith('@g.us')) return; 

        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (text) console.log(`📩 Mensaje de ${chatId}: ${text}`);
    });
}

// Iniciar proceso
startBot();
