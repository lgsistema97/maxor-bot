const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('Maxor Bot Online 🦷'));
app.listen(process.env.PORT || 3000);

// NUEVA API KEY QUE ME PASASTE
const GROQ_API_KEY = "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";

async function startBot() {
    // Mantenemos tu sesión activa para no pedir QR
    const { state, saveCreds } = await useMultiFileAuthState('sesion_fuerza_bruta');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Mac OS", "Safari", "17.0"],
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection } = update;
        if (connection === 'open') console.log('✅ MAXOR FUNCIONANDO CON NUEVA API');
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const chatId = msg.key.remoteJid;

        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        // --- OPCIÓN AUDIO: WHISPER (GROQ) ---
        if (msg.message.audioMessage) {
            await sock.sendPresenceUpdate('composing', chatId);
            const tempFile = `/tmp/audio_${Date.now()}.ogg`;
            try {
                const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
                const buffer = [];
                for await (const chunk of stream) buffer.push(chunk);
                fs.writeFileSync(tempFile, Buffer.concat(buffer));

                const formData = new FormData();
                formData.append('file', fs.createReadStream(tempFile));
                formData.append('model', 'whisper-large-v3');

                const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
                    headers: { 
                        ...formData.getHeaders(),
                        'Authorization': `Bearer ${GROQ_API_KEY.trim()}` 
                    }
                });
                text = res.data.text;
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            } catch (e) { 
                console.log("Error en transcripción Groq");
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            }
        }

        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: "Eres Maxor, asistente de Clínica Maxor. Usa emojis 🦷✨. Da respuestas cortas." },
                        { role: "user", content: text }
                    ]
                }, { 
                    headers: { "Authorization": `Bearer ${GROQ_API_KEY.trim()}`, "Content-Type": "application/json" } 
                });
                
                const respuestaIA = res.data.choices[0].message.content;
                await sock.sendMessage(chatId, { text: respuestaIA });

                // Envío a n8n
                axios.post("https://themiz97.app.n8n.cloud/webhook-test/test-pacientes", {
                    nombre: msg.pushName || "Paciente",
                    mensaje: text,
                    respuesta: respuestaIA
                }).catch(() => {});
            } catch (e) { console.log("Error en Chat Groq"); }
        }
    });
}

startBot();
