const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- SERVIDOR PARA RENDER ---
const app = express();
app.get('/', (req, res) => res.send('Maxor Bot - ElevenLabs Humano Activo 🦷'));
app.listen(process.env.PORT || 3000);

// --- CONFIGURACIÓN DE CLAVES (REVISA BIEN ESTO) ---
const GROQ_API_KEY = "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";
const ELEVENLABS_API_KEY = "sk_7ec9eb8924d0b2a40165fd043f8a291fba7cc18d7c0663d0";
const VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Voz de Adam (Cálida y profesional)

async function startBot() {
    // Nueva sesión para limpiar rastros de errores anteriores
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_final_humana');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Maxor AI", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) {
            console.log("📢 ESCANEA EL QR PARA ACTIVAR VOZ HUMANA:");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
        }
        if (connection === 'open') console.log('✅ MAXOR CONECTADO - VOZ HUMANA ELEVENLABS');
        if (connection === 'close') startBot();
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        let esAudio = false;

        // --- SYSTEM PROMPT (RESTRICCIONES) ---
        const systemPrompt = `Eres Maxor, asistente virtual de Clínica Dental Maxor.
        REGLAS DE ORO:
        1. Tu única misión es informar sobre servicios dentales y agendar citas.
        2. NO hables de otros temas (IP, turismo, noticias, internet). Si preguntan, di: "Solo estoy capacitado para ayudarte con temas dentales".
        3. No te presentes en cada mensaje. Solo saluda al inicio.
        4. El Dr. Orlando Reyes es parte del equipo médico, no el dueño.
        5. Sé amable, breve y profesional. Usa 2 emojis.`;

        // 1. PROCESAR AUDIO RECIBIDO
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
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            } catch (e) { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); }
        }

        // 2. GENERAR RESPUESTA E IA
        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` } });

                const respuestaIA = res.data.choices[0].message.content;

                if (esAudio) {
                    // Limpiamos el texto para ElevenLabs
                    const textoVoz = respuestaIA.replace(/[^\w\sáéíóúÁÉÍÓÚñÑ,.?!¿¡-]/g, '');

                    // LLAMADA CORREGIDA A ELEVENLABS
                    const audioRes = await axios({
                        method: 'post',
                        url: `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
                        data: {
                            text: textoVoz,
                            model_id: "eleven_multilingual_v2",
                            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
                        },
                        headers: {
                            "xi-api-key": ELEVENLABS_API_KEY,
                            "Content-Type": "application/json"
                        },
                        responseType: 'arraybuffer'
                    });

                    await sock.sendMessage(chatId, { 
                        audio: Buffer.from(audioRes.data), 
                        mimetype: 'audio/ogg; codecs=opus', 
                        ptt: true 
                    });
                } else {
                    await sock.sendMessage(chatId, { text: respuestaIA });
                }
            } catch (e) {
                const errorMsg = e.response?.data?.toString() || e.message;
                console.error("❌ Error Proceso:", errorMsg);
            }
        }
    });
}

startBot();
