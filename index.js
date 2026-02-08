const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage } = require("@whiskeysockets/baileys");
const { PollyClient, SynthesizeSpeechCommand } = require("@aws-sdk/client-polly");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- SERVIDOR PARA RENDER ---
const app = express();
app.get('/', (req, res) => res.send('Maxor Bot - Miguel Ogg/Opus Online 🦷'));
app.listen(process.env.PORT || 3000);

// --- CONFIGURACIÓN DE CREDENCIALES ---
const GROQ_API_KEY = "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";
const AWS_CONFIG = {
    region: "us-east-2", 
    credentials: {
        accessKeyId: "AKIAWIMAFPKT4HMOM5UD",
        secretAccessKey: "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"
    }
};

const pollyClient = new PollyClient(AWS_CONFIG);

async function startBot() {
    // Nueva sesión para asegurar una conexión limpia
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_ogg_final');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Maxor AWS", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) {
            console.log("📢 ESCANEA EL QR (NUEVA SESIÓN OGG):");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
        }
        if (connection === 'open') console.log('✅ MAXOR CONECTADO - FORMATO OGG/OPUS ACTIVADO');
        if (connection === 'close') startBot();
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        let esAudio = false;

        const systemPrompt = `Eres Maxor, asistente de la Clínica Maxor del Dr. Orlando Reyes. 
        REGLA DE TEXTO: Usa 2 emojis (🦷, ✨). 
        REGLA DE AUDIO: Sé breve y profesional.`;

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
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            } catch (e) { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); }
        }

        // 2. RESPUESTA E INTELIGENCIA
        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" } });

                const respuestaIA = res.data.choices[0].message.content;

                if (esAudio) {
                    const textoParaVoz = respuestaIA.replace(/[^\w\sáéíóúÁÉÍÓÚñÑ,.?!¿¡-]/g, '');

                    // AMAZON POLLY CONFIGURADO PARA CELULARES
                    const command = new SynthesizeSpeechCommand({
                        Text: textoParaVoz,
                        OutputFormat: "mp3", 
                        SampleRate: "16000", // Frecuencia estándar de notas de voz
                        VoiceId: "Miguel", 
                        Engine: "standard" 
                    });

                    const response = await pollyClient.send(command);
                    const chunks = [];
                    for await (const chunk of response.AudioStream) { chunks.push(chunk); }
                    const audioBuffer = Buffer.concat(chunks);

                    // ENVÍO CON MIMETYPE COMPATIBLE
                    await sock.sendMessage(chatId, { 
                        audio: audioBuffer, 
                        mimetype: 'audio/ogg; codecs=opus', // Obliga al móvil a reconocerlo como nota de voz
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
