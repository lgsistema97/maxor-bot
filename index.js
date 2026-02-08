const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.get('/', (req, res) => res.send('Maxor Bot Híbrido: Online 🦷'));
app.listen(process.env.PORT || 3000);

const GROQ_API_KEY = "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";
const GEMINI_API_KEY = "AIzaSyDJZbAQEcqsPXHMM7Zmpz8rHF3HPAaHbGE";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function startBot() {
    // Mantenemos el nombre para que NO pida QR de nuevo
    const { state, saveCreds } = await useMultiFileAuthState('sesion_fuerza_bruta');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Mac OS", "Safari", "17.0"],
        printQRInTerminal: false // Evita el error de depreciación de tu imagen 4
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) console.log("Link QR: https://api.qrserver.com/v1/create-qr-code/?data=" + encodeURIComponent(qr));
        if (connection === 'open') console.log('✅ MAXOR FUNCIONANDO PERFECTO');
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

        // --- PROCESAR AUDIO CON GEMINI ---
        if (msg.message.audioMessage) {
            try {
                const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
                const buffer = [];
                for await (const chunk of stream) buffer.push(chunk);
                
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const result = await model.generateContent([
                    "Transcribe este audio de WhatsApp:",
                    { inlineData: { data: Buffer.concat(buffer).toString("base64"), mimeType: "audio/ogg" } }
                ]);
                text = result.response.text();
            } catch (e) { console.error("Error Audio Gemini:", e.message); }
        }

        if (text) {
            try {
                // LLAMADA A GROQ CORREGIDA
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: "Eres Maxor, asistente de Clínica Maxor. Usa emojis 🦷✨. Da respuestas cortas y amables." },
                        { role: "user", content: text }
                    ]
                }, { 
                    headers: { 
                        "Authorization": `Bearer ${GROQ_API_KEY}`,
                        "Content-Type": "application/json"
                    } 
                });
                
                const respuestaIA = res.data.choices[0].message.content;
                await sock.sendMessage(chatId, { text: respuestaIA });
                
                // Envío a n8n
                axios.post("https://themiz97.app.n8n.cloud/webhook-test/test-pacientes", {
                    nombre: msg.pushName || "Paciente",
                    mensaje: text,
                    respuesta: respuestaIA
                }).catch(() => {});

            } catch (e) { console.error("Error Groq:", e.response?.data || e.message); }
        }
    });
}

startBot();
