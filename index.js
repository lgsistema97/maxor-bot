const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.get('/', (req, res) => res.send('Maxor Bot Status: Running 🦷'));
app.listen(process.env.PORT || 3000);

const GROQ_API_KEY = "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";
const GEMINI_API_KEY = "AIzaSyDJZbAQEcqsPXHMM7Zmpz8rHF3HPAaHbGE";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function startBot() {
    // CAMBIO DE NOMBRE DE SESIÓN PARA BORRAR EL ERROR ANTERIOR
    const { state, saveCreds } = await useMultiFileAuthState('sesion_fuerza_bruta');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        // IDENTIDAD DE NAVEGADOR CAMBIADA A MAC (Más estable)
        browser: ["Mac OS", "Safari", "17.0"],
        printQRInTerminal: true,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log("📢 ESCANEA ESTE NUEVO QR (LINK ACTUALIZADO):");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
        }
        if (connection === 'open') console.log('✅ CONECTADO EXITOSAMENTE');
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        // PROCESAR AUDIO CON GEMINI
        if (msg.message.audioMessage) {
            try {
                const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
                const buffer = [];
                for await (const chunk of stream) buffer.push(chunk);
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const result = await model.generateContent([
                    "Transcribe este audio de un paciente:",
                    { inlineData: { data: Buffer.concat(buffer).toString("base64"), mimeType: "audio/ogg" } }
                ]);
                text = result.response.text();
            } catch (e) { console.log("Error audio"); }
        }

        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: "Eres Maxor, asistente de Clínica Maxor. Usa emojis 🦷✨." },
                        { role: "user", content: text }
                    ]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` } });
                
                await sock.sendMessage(chatId, { text: res.data.choices[0].message.content });
                
                // Envío a n8n
                axios.post("https://themiz97.app.n8n.cloud/webhook-test/test-pacientes", {
                    nombre: msg.pushName || "Paciente",
                    mensaje: text
                }).catch(() => {});
            } catch (e) { console.log("Error Groq"); }
        }
    });
}

startBot();
