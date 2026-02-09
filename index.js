const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage } = require("@whiskeysockets/baileys");
const { createClient } = require('@supabase/supabase-js');
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- CONFIGURACIÓN DE BASE DE DATOS (SUPABASE) ---
const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_KEY
);

// --- SERVIDOR PARA MANTENER VIVO EL PROCESO EN KOYEB ---
const app = express();
app.get('/', (req, res) => res.send('Maxor Bot Activo 🦷🤵‍♂️'));
app.listen(process.env.PORT || 3000);

// --- CONFIGURACIÓN DE APIS (LEÍDAS DESDE SETTINGS DE KOYEB) ---
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY;

async function startBot() {
    // Nombre de sesión único para evitar conflictos
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_v1');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Maxor AI", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        
        if (qr) {
            console.log("************************************************");
            console.log("👇 ¡AQUÍ ESTÁ TU QR! COPIA Y ABRE ESTE LINK 👇");
            console.log("https://api.qrserver.com/v1/create-qr-code/?data=" + encodeURIComponent(qr));
            console.log("************************************************");
        }

        if (connection === 'open') {
            console.log('✅✅✅ MAXOR CONECTADO EXITOSAMENTE ✅✅✅');
        }
        
        if (connection === 'close') {
            console.log('⚠️ Conexión perdida, reintentando...');
            startBot();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        if (chatId.endsWith('@g.us')) return; // Ignorar grupos

        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        let esAudio = !!msg.message.audioMessage;

        const systemPrompt = `Eres Maxor, el asistente virtual de la Clínica Dental Maxor en Caracas. 
        Responde como un hombre profesional, amable y con acento caraqueño. Sé breve y directo.`;

        // 1. SI RECIBES AUDIO: TRANSCRIPCIÓN CON WHISPER (GROQ)
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
            } catch (e) { 
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                console.log("Error procesando audio:", e.message);
            }
        }

        // 2. GENERAR RESPUESTA CON IA Y GUARDAR EN DASHBOARD
        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` } });

                let respuestaIA = res.data.choices[0].message.content;

                // GUARDAR EN TU DASHBOARD DE SUPABASE
                await supabase.from('chats').insert([
                    { whatsapp_id: chatId, mensaje_usuario: text, respuesta_ia: respuestaIA }
                ]);

                // 3. ENVIAR RESPUESTA (VOZ SI EL ORIGEN FUE AUDIO, TEXTO SI NO)
                if (esAudio) {
                    // LIMPIEZA DE CARACTERES PARA GOOGLE TTS
                    const textoLimpio = respuestaIA
                        .replace(/[\u1000-\uFFFF]+/g, '')
                        .replace(/[^\w\sáéíóúÁÉÍÓÚñÑ,.?!¿¡-]/g, '')
                        .trim();

                    const googleRes = await axios.post(
                        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`,
                        {
                            input: { text: textoLimpio },
                            voice: { languageCode: "es-US", name: "es-US-Journey-D" },
                            audioConfig: { audioEncoding: "OGG_OPUS" }
                        }
                    );
                    const audioBuffer = Buffer.from(googleRes.data.audioContent, 'base64');
                    await sock.sendMessage(chatId, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                } else {
                    await sock.sendMessage(chatId, { text: respuestaIA });
                }
            } catch (e) { console.error("Error en flujo principal:", e.message); }
        }
    });
}

startBot();
