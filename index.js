const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const { PollyClient, SynthesizeSpeechCommand } = require("@aws-sdk/client-polly");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('Maxor Bot con AWS Polly Online 🦷'));
app.listen(process.env.PORT || 3000);

// --- CONFIGURACIÓN DE LLAVES ---
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
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_aws_final');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Maxor AWS", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) console.log("Link QR: https://api.qrserver.com/v1/create-qr-code/?data=" + encodeURIComponent(qr));
        if (connection === 'open') console.log('✅ MAXOR CON VOZ DE AMAZON ACTIVADA');
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
        REGLA: En texto escrito usa siempre emojis (🦷, ✨). En audios sé breve y profesional.`;

        // 1. PROCESAR AUDIO ENTRANTE (WHISPER)
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

        // 2. GENERAR RESPUESTA CON IA Y AWS POLLY
        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" } });

                const respuestaIA = res.data.choices[0].message.content;

                if (esAudio) {
                    // Limpiamos emojis para que Amazon no intente leerlos
                    const textoParaVoz = respuestaIA.replace(/[^\w\sáéíóúÁÉÍÓÚñÑ,.?!¿¡-]/g, '');

                    const command = new SynthesizeSpeechCommand({
                        Text: textoParaVoz,
                        OutputFormat: "mp3",
                        VoiceId: "Andres", 
                        Engine: "neural"    
                    });

                    const response = await pollyClient.send(command);
                    
                    // Convertir el audio de Amazon a Buffer
                    const chunks = [];
                    for await (const chunk of response.AudioStream) { chunks.push(chunk); }
                    const audioBuffer = Buffer.concat(chunks);

                    await sock.sendMessage(chatId, { 
                        audio: audioBuffer, 
                        mimetype: 'audio/mp4', 
                        ptt: true 
                    });
                } else {
                    await sock.sendMessage(chatId, { text: respuestaIA });
                }
            } catch (e) { console.error("Error en AWS Polly:", e.message); }
        }
    });
}

startBot();
