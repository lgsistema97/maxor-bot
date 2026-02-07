const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Maxor Bot QR Mode 🦷'));
app.listen(port, () => console.log(`Servidor en puerto ${port}`));

const GROQ_API_KEY = "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";
const MODELO = "llama-3.3-70b-versatile";

async function startBot() {
    // Cambiamos el nombre de la carpeta para forzar un QR totalmente nuevo
    const { state, saveCreds } = await useMultiFileAuthState('sesion_qr_nueva_final');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        // Esta configuración de browser es la más aceptada para evitar bloqueos
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        printQRInTerminal: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("📢 NUEVO QR GENERADO. ESCANEA RÁPIDO:");
            console.log(`🔗 LINK: https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ ¡CONECTADO EXITOSAMENTE!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const chatId = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (text) {
            try {
                // Respuesta rápida para probar conexión
                await sock.sendMessage(chatId, { text: "¡Hola! Soy Maxor. ✨ Recibí tu mensaje correctamente. 🦷" });
                
                // Envío a n8n
                await axios.post("https://themiz97.app.n8n.cloud/webhook-test/test-pacientes", {
                    nombre: msg.pushName || "Paciente",
                    telefono: chatId.split('@')[0],
                    mensaje: text
                });
            } catch (e) { console.log("Error en envío"); }
        }
    });
}

startBot();
