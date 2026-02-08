const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('Maxor Bot Pro V9 (ElevenLabs) Online 🦷'));
app.listen(process.env.PORT || 3000);

// CONFIGURACIONES
const GROQ_API_KEY = "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";
const ELEVENLABS_API_KEY = "sk_f85df6f288ec53671cc5f580d3ec02fb40f3035a3ae4faa2";
const VOICE_ID = "pNInz6obpgDQGcFmaJgB"; // Voz profesional masculina (Adam)

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_final_v3');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Maxor Bot", "Chrome", "1.0.0"],
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) console.log("Link QR: https://api.qrserver.com/v1/create-qr-code/?data=" + encodeURIComponent(qr));
        if (connection === 'open') console.log('✅ MAXOR V9 CON ELEVENLABS CONECTADO');
        if (connection === 'close') startBot();
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        let esAudio = false;

        const systemPrompt = `Eres Maxor, asistente de Clínica Maxor. Director: Dr. Orlando Reyes. 
        REGLA DE ORO: En tus respuestas escritas DEBES usar siempre 2 o 3 emojis (🦷, ✨, 🪥).
        Sé breve, amable y profesional.`;

        // --- 1. TRANSCRIPCIÓN DE AUDIO ---
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

        // --- 2. GENERACIÓN DE RESPUESTA ---
        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" } });

                const respuestaIA = res.data.choices[0].message.content;

                if (esAudio) {
                    // LIMPIEZA DE TEXTO PARA VOZ (Sin emojis)
                    const textoParaVoz = respuestaIA.replace(/[^\w\sáéíóúÁÉÍÓÚñÑ,.?!¿¡-]/g, '');

                    // GENERACIÓN CON ELEVENLABS
                    const response = await axios.post(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
                        text: textoParaVoz,
                        model_id: "eleven_multilingual_v2",
                        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
                    }, {
                        headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
                        responseType: 'arraybuffer'
                    });

                    // ENVÍO DIRECTO DESDE BUFFER (Soluciona error de reproducción)
                    await sock.sendMessage(chatId, { 
                        audio: Buffer.from(response.data), 
                        mimetype: 'audio/mp4', 
                        ptt: true 
                    });
                } else {
                    await sock.sendMessage(chatId, { text: respuestaIA });
                }

                // Webhook n8n
                axios.post("https://themiz97.app.n8n.cloud/webhook-test/test-pacientes", {
                    nombre: msg.pushName || "Paciente",
                    mensaje: text,
                    respuesta: respuestaIA
                }).catch(() => {});

            } catch (e) { console.error("Error en el proceso:", e.message); }
        }
    });
}

startBot();
