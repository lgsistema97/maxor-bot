const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');
const googleTTS = require('google-tts-api'); // Usamos este que es el más ligero

const app = express();
app.get('/', (req, res) => res.send('Maxor Bot Online 🦷'));
app.listen(process.env.PORT || 3000);

const GROQ_API_KEY = "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";

async function startBot() {
    // Usamos el nombre de sesión que te funcionó
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_final_v3');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Mac OS", "Safari", "17.0"],
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log("📢 ESCANEA ESTE QR NUEVO:");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
        }

        if (connection === 'open') {
            console.log('✅ MAXOR CONECTADO Y LISTO');
        }

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
        let esAudio = false;

        // --- PROMPT CON INFO COMPLETA ---
        const systemPrompt = `Eres Maxor, asistente de la Clínica Maxor en El Hatillo. Director: Dr. Orlando Reyes Rodríguez (Cirujano Maxilofacial). 
        Especialista en implantes, cordales y cirugía ortognática. 
        REGLA: Si recibes audio, responderás de forma muy breve. No menciones que eres una IA. No leas emojis.`;

        // --- 1. PROCESAMIENTO DE AUDIO ENTRANTE ---
        if (msg.message.audioMessage) {
            esAudio = true;
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
                    headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${GROQ_API_KEY.trim()}` }
                });
                text = res.data.text;
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            } catch (e) {
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            }
        }

        // --- 2. RESPUESTA DE LA IA ---
        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: text }
                    ]
                }, { 
                    headers: { "Authorization": `Bearer ${GROQ_API_KEY.trim()}`, "Content-Type": "application/json" } 
                });
                
                const respuestaIA = res.data.choices[0].message.content;

                if (esAudio) {
                    // Limpieza simple para que no lea emojis
                    const textoLimpio = respuestaIA.replace(/[^\w\sáéíóúÁÉÍÓÚñÑ,.?!¿¡-]/g, '');
                    const audioUrl = googleTTS.getAudioUrl(textoLimpio, { lang: 'es-MX', slow: false });

                    await sock.sendMessage(chatId, { 
                        audio: { url: audioUrl }, 
                        mimetype: 'audio/mp4', 
                        ptt: true 
                    });
                } else {
                    await sock.sendMessage(chatId, { text: respuestaIA });
                }

                // WEBHOOK N8N
                axios.post("https://themiz97.app.n8n.cloud/webhook-test/test-pacientes", {
                    nombre: msg.pushName || "Paciente",
                    mensaje: text,
                    respuesta: respuestaIA
                }).catch(() => {});

            } catch (e) {
                console.error("Error:", e.message);
            }
        }
    });
}

startBot();
