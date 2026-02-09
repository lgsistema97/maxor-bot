const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- SERVIDOR PARA RENDER ---
const app = express();
// Render asigna un puerto dinámico, usamos process.env.PORT para evitar errores
const PORT = process.env.PORT || 10000; 
app.get('/', (req, res) => res.send('Maxor Bot - Modo Masculino Fluido 🦷🤵‍♂️'));
app.listen(PORT, '0.0.0.0', () => console.log(`🌍 Servidor activo en puerto ${PORT}`));

// --- CONFIGURACIÓN DE APIS ---
const GROQ_API_KEY = "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";
const GOOGLE_TTS_API_KEY = "AIzaSyA9twZINwlgQ1s9w-brp9XS00cdl_EbF9U";

async function startBot() {
    // Se usa la carpeta de sesión que tenías definida
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_caracas_v1');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        // Navegador actualizado para mayor compatibilidad con Render
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        connectTimeoutMs: 60000,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        // --- IMPRESIÓN DEL QR ---
        if (qr) {
            console.log("-------------------------------------------------");
            console.log("📢 COPIA ESTE LINK PARA VER EL QR:");
            console.log("https://api.qrserver.com/v1/create-qr-code/?data=" + encodeURIComponent(qr));
            console.log("-------------------------------------------------");
        }

        if (connection === 'open') {
            console.log('✅ MAXOR CONECTADO - VOZ MASCULINA FLUIDA');
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            // Si no es un cierre voluntario, reintentamos con un pequeño retraso para no saturar los logs
            const debeReintentar = statusCode !== DisconnectReason.loggedOut;
            console.log(`⚠️ Conexión cerrada (Código: ${statusCode}). Reintentando en 10s...`);
            if (debeReintentar) {
                setTimeout(() => startBot(), 10000);
            }
        }
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

        // --- 2. SYSTEM PROMPT ---
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
                    const textoParaVoz = respuestaIA
                        .replace(/[\u1000-\uFFFF]+/g, '') 
                        .replace(/[^\w\sáéíóúÁÉÍÓÚñÑ,.?!¿¡-]/g, '') 
                        .trim();

                    try {
                        const googleRes = await axios.post(
                            `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`,
                            {
                                input: { text: textoParaVoz },
                                voice: { 
                                    languageCode: "es-US", 
                                    name: "es-US-Journey-D" 
                                },
                                audioConfig: { 
                                    audioEncoding: "OGG_OPUS",
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
