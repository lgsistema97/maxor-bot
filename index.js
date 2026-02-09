const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage } = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- SERVIDOR PARA RENDER (Optimizado) ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.status(200).send('Maxor Bot Activo 🦷🤵‍♂️'));
app.get('/health', (req, res) => res.status(200).send('OK'));
app.listen(PORT, '0.0.0.0', () => console.log(`🌍 Servidor en puerto ${PORT}`));

// --- CONFIGURACIÓN DE APIS (Usa Variables de Entorno en Render) ---
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY;

async function startBot() {
    // Usamos el nombre de sesión que ya tenías
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_caracas_v1');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"], // Identificador más estable
        connectTimeoutMs: 60000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log("************************************************");
            console.log("📢 QR LINK: https://api.qrserver.com/v1/create-qr-code/?data=" + encodeURIComponent(qr));
            console.log("************************************************");
        }
        
        if (connection === 'open') console.log('✅ MAXOR CONECTADO - VOZ MASCULINA FLUIDA');
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
            console.log('⚠️ Conexión cerrada, reintentando...', shouldReconnect);
            if (shouldReconnect) setTimeout(() => startBot(), 5000); // Espera 5s antes de volver
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

        const systemPrompt = `Eres Maxor, el asistente virtual de la Clínica Dental Maxor en Caracas.
        - TONO: Hombre profesional, amable y caraqueño.
        - RESTRICCIÓN: Solo odontología. Sé breve y fluido.`;

        // --- PROCESAR AUDIO ---
        if (esAudio) {
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
                    headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${GROQ_API_KEY}` }
                });
                text = res.data.text;
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            } catch (e) { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); }
        }

        // --- RESPUESTA IA Y VOZ ---
        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` } });

                let respuestaIA = res.data.choices[0].message.content;

                if (esAudio) {
                    const textoParaVoz = respuestaIA.replace(/[\u1000-\uFFFF]+/g, '').replace(/[^\w\sáéíóúÁÉÍÓÚñÑ,.?!¿¡-]/g, '').trim();
                    try {
                        const googleRes = await axios.post(
                            `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`,
                            {
                                input: { text: textoParaVoz },
                                voice: { languageCode: "es-US", name: "es-US-Journey-D" },
                                audioConfig: { audioEncoding: "OGG_OPUS" }
                            }
                        );
                        const audioBuffer = Buffer.from(googleRes.data.audioContent, 'base64');
                        await sock.sendMessage(chatId, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                    } catch (vErr) {
                        await sock.sendMessage(chatId, { text: respuestaIA });
                    }
                } else {
                    await sock.sendMessage(chatId, { text: respuestaIA });
                }
            } catch (e) { console.error("Error:", e.message); }
        }
    });
}

startBot();
