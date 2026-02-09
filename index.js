const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('Maxor Bot - Google Journey Online 🦷'));
app.listen(process.env.PORT || 3000);

// --- TUS CLAVES FINALES ---
const GROQ_API_KEY = "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";
const GOOGLE_TTS_API_KEY = "AIzaSyA9twZINwlgQ1s9w-brp9XS00cdl_EbF9U";

async function startBot() {
    // Sesión limpia para Google Journey
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_google_v1');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Maxor Google", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) {
            console.log("📢 ESCANEA EL QR PARA ACTIVAR VOZ JOURNEY:");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
        }
        if (connection === 'open') console.log('✅ MAXOR CONECTADO - VOZ GOOGLE JOURNEY ACTIVADA');
        if (connection === 'close') startBot();
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        let esAudio = !!msg.message.audioMessage;

        // --- SYSTEM PROMPT CON RESTRICCIONES ---
        const systemPrompt = `Eres Maxor, el asistente virtual de la Clínica Dental Maxor. 
        REGLAS:
        1. Tu única misión es informar sobre servicios dentales y agendar citas.
        2. NO hables de otros temas (IP, turismo, noticias, internet). Di: "Solo puedo ayudarte con temas dentales".
        3. No te presentes en cada mensaje. Solo saluda al inicio.
        4. Sé amable, breve y profesional. Usa 2 emojis.`;

        // 1. TRANSCRIPCIÓN (WHISPER)
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
                fs.unlinkSync(tempFile);
            } catch (e) { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); }
        }

        // 2. INTELIGENCIA Y VOZ JOURNEY
        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` } });

                const respuestaIA = res.data.choices[0].message.content;

                if (esAudio) {
                    // LLAMADA A GOOGLE CLOUD TTS (VOZ JOURNEY)
                    const googleRes = await axios.post(
                        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`,
                        {
                            input: { text: respuestaIA.replace(/[^\w\sáéíóúÁÉÍÓÚñÑ,.?!¿¡-]/g, '') },
                            voice: { 
                                languageCode: "es-ES", 
                                name: "es-ES-Journey-F" // Voz Journey (La más humana de Google)
                            },
                            audioConfig: { 
                                audioEncoding: "OGG_OPUS" // Formato perfecto para WhatsApp
                            }
                        }
                    );

                    const audioBuffer = Buffer.from(googleRes.data.audioContent, 'base64');

                    await sock.sendMessage(chatId, { 
                        audio: audioBuffer, 
                        mimetype: 'audio/ogg; codecs=opus', 
                        ptt: true 
                    });
                } else {
                    await sock.sendMessage(chatId, { text: respuestaIA });
                }
            } catch (e) { 
                console.error("❌ Error:", e.response?.data || e.message); 
            }
        }
    });
}
startBot();
