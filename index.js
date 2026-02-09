const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- SERVIDOR PARA RENDER ---
const app = express();
app.get('/', (req, res) => res.send('Maxor Bot - Voz Journey Caracas Activa 🦷🇻🇪'));
app.listen(process.env.PORT || 3000);

// --- CONFIGURACIÓN DE APIS ---
const GROQ_API_KEY = "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";
const GOOGLE_TTS_API_KEY = "AIzaSyA9twZINwlgQ1s9w-brp9XS00cdl_EbF9U";

async function startBot() {
    // Sesión con nombre único para evitar conflictos de caché
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
            console.log("📢 ESCANEA EL QR PARA ACTIVAR MAXOR (ACENTO LATINO):");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
        }
        if (connection === 'open') console.log('✅ MAXOR CONECTADO - VOZ JOURNEY LATINA');
        if (connection === 'close') startBot();
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        let esAudio = !!msg.message.audioMessage;

        // --- SYSTEM PROMPT PERSONALIZADO (CARACAS + RESTRICCIONES) ---
        const systemPrompt = `Eres Maxor, el asistente virtual inteligente de la Clínica Dental Maxor en Caracas.
        REGLAS CRÍTICAS:
        1. Tu única misión es atender dudas sobre la clínica y persuadir amablemente al cliente para que agende una cita.
        2. NO hables de otros temas ajenos (IPs, sitios turísticos, noticias, tecnología). Si te preguntan, responde: "Lo siento, como asistente de Clínica Maxor solo puedo ayudarte con temas relacionados a tu salud dental".
        3. No te presentes en cada mensaje si ya hay una charla abierta. 
        4. USA ACENTO NEUTRO/LATINO. No uses modismos españoles (nada de "vale", "os", "zumo"). Habla con calidez profesional.
        5. El Dr. Orlando Reyes es parte del equipo médico, no el dueño. 
        6. Sé breve y usa emojis (🦷, ✨).`;

        // 1. PROCESAR AUDIO RECIBIDO (TRANSCRIPCIÓN)
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

        // 2. GENERAR RESPUESTA E IA
        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` } });

                const respuestaIA = res.data.choices[0].message.content;

                if (esAudio) {
                    // LIMPIEZA DE TEXTO PARA VOZ
                    const textoVoz = respuestaIA.replace(/[^\w\sáéíóúÁÉÍÓÚñÑ,.?!¿¡-]/g, '');

                    // LLAMADA A GOOGLE JOURNEY (ACENTO LATINO)
                    const googleRes = await axios.post(
                        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`,
                        {
                            input: { text: textoVoz },
                            voice: { 
                                languageCode: "es-US", // Configuración para evitar el acento de España
                                name: "es-US-Journey-F" // Voz Journey con tono cálido latino
                            },
                            audioConfig: { 
                                audioEncoding: "OGG_OPUS" // Formato nativo de WhatsApp
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
                console.error("❌ Error en el proceso:", e.response?.data || e.message);
            }
        }
    });
}

startBot();
