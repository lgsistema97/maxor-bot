const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- SERVIDOR PARA RENDER ---
const app = express();
app.get('/', (req, res) => res.send('Maxor Bot - Modo Masculino Fluido 🦷🤵‍♂️'));
app.listen(process.env.PORT || 3000);

// --- CONFIGURACIÓN DE APIS ---
const GROQ_API_KEY = "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";
const GOOGLE_TTS_API_KEY = "AIzaSyA9twZINwlgQ1s9w-brp9XS00cdl_EbF9U";

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_caracas_v1');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Maxor AI", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) console.log("📢 QR: https://api.qrserver.com/v1/create-qr-code/?data=" + encodeURIComponent(qr));
        if (connection === 'open') console.log('✅ MAXOR CONECTADO - VOZ MASCULINA FLUIDA');
        if (connection === 'close') startBot();
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;

        // --- 1. FILTRO DE GRUPOS ---
        if (chatId.endsWith('@g.us')) return;

        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        let esAudio = !!msg.message.audioMessage;

        // --- 2. SYSTEM PROMPT MEJORADO (LIBERTAD E INTELIGENCIA) ---
        const systemPrompt = `Eres Maxor, el asistente virtual de la Clínica Dental Maxor en Caracas.
        
        DINÁMICA DE CONVERSACIÓN:
        - PRESENTACIÓN: Saluda y preséntate SOLO si el chat es nuevo o el usuario dice "Hola". Si ya están hablando, ve directo al punto. No repitas tu nombre en cada audio.
        - DOCTOR ORLANDO REYES: Solo menciónalo si el paciente pregunta específicamente por quién atiende, por especialistas o citas. No lo nombres sin contexto.
        - TONO: Eres un hombre profesional, amable y caraqueño. Evita modismos de España. Tienes libertad para conversar de forma fluida y natural sobre salud dental.
        - RESTRICCIÓN: Si preguntan cosas fuera de la odontología, declina amablemente diciendo que tu especialidad es cuidar sonrisas.
        - FORMATO: Sé breve. No uses listas largas a menos que te las pidan.`;

        // --- 3. PROCESAR AUDIO RECIBIDO ---
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

        // --- 4. RESPUESTA IA Y VOZ ---
        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` } });

                let respuestaIA = res.data.choices[0].message.content;

                if (esAudio) {
                    // LIMPIEZA AGRESIVA PARA EVITAR ERROR 400 EN GOOGLE TTS
                    const textoParaVoz = respuestaIA
                        .replace(/[\u1000-\uFFFF]+/g, '') // Elimina emojis y símbolos Unicode
                        .replace(/[^\w\sáéíóúÁÉÍÓÚñÑ,.?!¿¡-]/g, '') // Solo deja texto legible
                        .trim();

                    try {
                        const googleRes = await axios.post(
                            `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`,
                            {
                                input: { text: textoParaVoz },
                                voice: { 
                                    languageCode: "es-US", 
                                    name: "es-US-Journey-D" // VOZ MASCULINA LATINA
                                },
                                audioConfig: { 
                                    audioEncoding: "OGG_OPUS",
                                    pitch: -1.0 // Un poco más grave para sonar varonil
                                }
                            }
                        );

                        const audioBuffer = Buffer.from(googleRes.data.audioContent, 'base64');
                        await sock.sendMessage(chatId, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                    } catch (vErr) {
                        console.error("Fallo TTS, enviando texto:", vErr.response?.data || vErr.message);
                        await sock.sendMessage(chatId, { text: respuestaIA });
                    }
                } else {
                    await sock.sendMessage(chatId, { text: respuestaIA });
                }
            } catch (e) { console.error("Error General:", e.response?.data || e.message); }
        }
    });
}

startBot();
