const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- SERVIDOR PARA RENDER ---
const app = express();
app.get('/', (req, res) => res.send('Maxor Bot - Caracas Edition Activo 🦷🇻🇪'));
app.listen(process.env.PORT || 3000);

// --- CONFIGURACIÓN DE APIS ---
const GROQ_API_KEY = "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";
const GOOGLE_TTS_API_KEY = "AIzaSyA9twZINwlgQ1s9w-brp9XS00cdl_EbF9U";

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_caracas_v1');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Maxor Caracas", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) {
            console.log("📢 ESCANEA EL QR:");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
        }
        if (connection === 'open') console.log('✅ MAXOR CONECTADO - SIN GRUPOS');
        if (connection === 'close') startBot();
    });

    // --- MANEJO DE LLAMADAS (RECHAZO AMABLE) ---
    sock.ev.on('call', async (call) => {
        const { id, from, status } = call[0];
        if (status === 'offer') {
            await sock.rejectCall(id, from);
            const msgAudio = "Hola, soy Maxor. Por ahora no puedo atender llamadas, pero por favor déjame un audio o mensaje y te ayudo de inmediato. 🦷";
            // Envío de audio automático omitido aquí para brevedad, pero sigue la misma lógica de TTS abajo.
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;

        // --- FILTRO DE GRUPOS: SOLO RESPONDE A CHATS INDIVIDUALES ---
        if (chatId.endsWith('@g.us')) {
            console.log("🚫 Mensaje de grupo ignorado.");
            return;
        }

        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        let esAudio = !!msg.message.audioMessage;

        // --- SYSTEM PROMPT (PRESENTACIÓN CONDICIONAL) ---
        // La IA decidirá si presentarse basándose en si el saludo inicial es necesario
        const systemPrompt = `Eres Maxor, el asistente virtual de la Clínica Dental Maxor en Caracas.
        INSTRUCCIÓN DE PRESENTACIÓN: 
        Si el usuario te está saludando por primera vez o el chat parece nuevo, preséntate amablemente: "Hola, soy Maxor, el asistente virtual de la Clínica Dental Maxor...". 
        Si la conversación ya está avanzada, NO vuelvas a presentarte.

        REGLAS:
        1. Solo hablas de salud dental y la clínica.
        2. NO hables de otros temas (IP, turismo, etc.).
        3. Usa acento latino neutro (nada de modismos de España).
        4. Dr. Orlando Reyes es del equipo médico.
        5. Sé breve, amable y usa 2 emojis.`;

        // 1. TRANSCRIPCIÓN SI ES AUDIO
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

        // 2. RESPUESTA CON IA Y VOZ JOURNEY
        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` } });

                const respuestaIA = res.data.choices[0].message.content;

                if (esAudio) {
                    const googleRes = await axios.post(
                        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`,
                        {
                            input: { text: respuestaIA.replace(/[^\w\sáéíóúÁÉÍÓÚñÑ,.?!¿¡-]/g, '') },
                            voice: { languageCode: "es-US", name: "es-US-Journey-D" },
                            audioConfig: { audioEncoding: "OGG_OPUS" }
                        }
                    );

                    const audioBuffer = Buffer.from(googleRes.data.audioContent, 'base64');
                    await sock.sendMessage(chatId, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                } else {
                    await sock.sendMessage(chatId, { text: respuestaIA });
                }
            } catch (e) { console.error("❌ Error:", e.message); }
        }
    });
}

startBot();
