const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('Maxor Bot - Inteligencia Fluida Activa 🦷🤵‍♂️'));
app.listen(process.env.PORT || 3000);

const GROQ_API_KEY = "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";
const GOOGLE_TTS_API_KEY = "AIzaSyA9twZINwlgQ1s9w-brp9XS00cdl_EbF9U";

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_caracas_v1');
    const sock = makeWASocket({ auth: state, logger: pino({ level: "silent" }), browser: ["Maxor AI", "Chrome", "1.0.0"] });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) console.log("Escanea el QR: https://api.qrserver.com/v1/create-qr-code/?data=" + encodeURIComponent(qr));
        if (connection === 'open') console.log('✅ MAXOR CONECTADO - MODO FLUIDO');
        if (connection === 'close') startBot();
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        if (chatId.endsWith('@g.us')) return; // Filtro de grupos

        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        let esAudio = !!msg.message.audioMessage;

        // --- NUEVO SYSTEM PROMPT (MÁS LIBERTAD Y MENOS REPETICIÓN) ---
        const systemPrompt = `Eres Maxor, el asistente virtual de la Clínica Dental Maxor en Caracas. 
        
        DINÁMICA DE CONVERSACIÓN:
        1. PRESENTACIÓN: Preséntate SOLO en el primer mensaje del chat. Si ya estás hablando con la persona, ve directo al grano o usa saludos cortos como "¿En qué más te ayudo?". No repitas "Soy Maxor" en cada respuesta.
        2. EL EQUIPO MÉDICO: Solo menciona al Dr. Orlando Reyes si el paciente pregunta quién atiende, por especialistas o por citas específicas. No lo nombres sin motivo.
        3. PERSONALIDAD: Tienes libertad para sonar humano, empático y profesional. No parezcas un formulario. Si el usuario bromea o comenta algo casual (relacionado a su salud o cita), síguele la corriente amablemente.
        4. RESTRICCIÓN: Mantente en el área dental, pero no seas cortante. Si preguntan algo no dental, di con naturalidad que tu fuerte es ayudarte con su sonrisa.
        5. LENGUAJE: Acento caraqueño profesional (Latino neutro). Sin modismos de España.`;

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
                const resTrans = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
                    headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${GROQ_API_KEY}` }
                });
                text = resTrans.data.text;
                fs.unlinkSync(tempFile);
            } catch (e) { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); }
        }

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
                            voice: { languageCode: "es-US", name: "es-US-Journey-D" }, // VOZ DE HOMBRE
                            audioConfig: { audioEncoding: "OGG_OPUS", pitch: -0.5 }
                        }
                    );
                    const audioBuffer = Buffer.from(googleRes.data.audioContent, 'base64');
                    await sock.sendMessage(chatId, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                } else {
                    await sock.sendMessage(chatId, { text: respuestaIA });
                }
            } catch (e) { console.error("Error:", e.message); }
        }
    });
}
startBot();
