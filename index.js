const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason, delay } = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('Maxor Bot Activo 🦷'));
app.listen(process.env.PORT || 3000);

const GROQ_API_KEY = "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";
const MODELO = "llama-3.3-70b-versatile";

// --- CAMBIA ESTO POR TU NÚMERO DE WHATSAPP (CON CÓDIGO DE PAÍS) ---
// Ejemplo para Venezuela: "584121234567"
const MI_NUMERO = "TU_NUMERO_AQUI"; 

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session_final_pairing');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        printQRInTerminal: false // Desactivamos el QR para usar Pairing Code
    });

    // --- LÓGICA DE PAIRING CODE ---
    if (!sock.authState.creds.registered) {
        console.log(`📢 GENERANDO CÓDIGO PARA: ${MI_NUMERO}`);
        await delay(5000); // Esperamos a que el socket esté listo
        const code = await sock.requestPairingCode(MI_NUMERO);
        console.log(`✅ TU CÓDIGO DE VINCULACIÓN ES: ${code}`);
        console.log(`💡 PASOS: Abre WhatsApp > Dispositivos vinculados > Vincular con número de teléfono > Escribe el código: ${code}`);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ ¡CONECTADO CON ÉXITO!');
        }
    });

    // ... (El resto de tu lógica de IA y audios se mantiene igual abajo)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const chatId = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (text) {
            // Aquí iría tu lógica de Groq y n8n que ya tienes configurada
            await sock.sendMessage(chatId, { text: "¡Hola! Estoy terminando de configurarme. 🦷" });
        }
    });
}

startBot();
