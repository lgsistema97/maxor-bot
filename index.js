const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('Maxor Bot - ElevenLabs Ultra-Realista Online 🦷'));
app.listen(process.env.PORT || 3000);

// --- CLAVES DE API ---
const GROQ_API_KEY = "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";
const ELEVENLABS_API_KEY = "sk_7ec9eb8924d0b2a40165fd043f8a291fba7cc18d7c0663d0";
const VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Voz "Adam", muy profesional y cálida. Puedes cambiarla en ElevenLabs.

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_elevenlabs');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Maxor Eleven", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) console.log("QR Link: https://api.qrserver.com/v1/create-qr-code/?data=" + encodeURIComponent(qr));
        if (connection === 'open') console.log('✅ MAXOR CONECTADO CON ELEVENLABS');
        if (connection === 'close') startBot();
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        let esAudio = false;

        // --- SYSTEM PROMPT BLINDADO ---
        const systemPrompt = `Eres Maxor, el asistente virtual de la Clínica Dental Maxor. 
        REGLAS:
        1. Tu objetivo es que el paciente agende una cita médica de forma amable.
        2. NO respondas nada que no sea sobre salud dental o la clínica (prohibido temas de IP, turismo, etc.).
        3. Si te preguntan algo ajeno, di: "Solo puedo ayudarte con temas dentales en Clínica Maxor".
        4. No te presentes en cada mensaje si ya estás hablando con el usuario.
        5. Dr. Orlando Reyes es parte del equipo, pero no digas que es el dueño.`;

        // 1. TRANSCRIPCIÓN (WHISPER)
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
                    headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${GROQ_API_KEY}` }
                });
                text = res.data.text;
                fs.unlinkSync(tempFile);
            } catch (e) { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); }
        }

        // 2. INTELIGENCIA Y VOZ HUMANA
        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` } });

                const respuestaIA = res.data.choices[0].message.content;

                if (esAudio) {
                    // Quitamos emojis para que no afecten la entonación de ElevenLabs
                    const textoParaVoz = respuestaIA.replace(/[^\w\sáéíóúÁÉÍÓÚñÑ,.?!¿¡-]/g, '');

                    const response = await axios.post(
                        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
                        {
                            text: textoParaVoz,
                            model_id: "eleven_multilingual_v2", // El mejor modelo para español
                            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
                        },
                        {
                            headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
                            responseType: 'arraybuffer'
                        }
                    );

                    const audioBuffer = Buffer.from(response.data);

                    await sock.sendMessage(chatId, { 
                        audio: audioBuffer, 
                        mimetype: 'audio/ogg; codecs=opus', 
                        ptt: true 
                    });
                } else {
                    await sock.sendMessage(chatId, { text: respuestaIA });
                }
            } catch (e) { console.error("Error:", e.message); }
        }
    });
}
startBot();
