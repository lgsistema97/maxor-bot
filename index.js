const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage } = require("@whiskeysockets/baileys");
const { PollyClient, SynthesizeSpeechCommand } = require("@aws-sdk/client-polly");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('Maxor Bot - Miguel AWS Online 🦷'));
app.listen(process.env.PORT || 3000);

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
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_final_miguel');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Maxor AWS", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) console.log("QR Link: https://api.qrserver.com/v1/create-qr-code/?data=" + encodeURIComponent(qr));
        if (connection === 'open') console.log('✅ MAXOR CONECTADO (VOZ: MIGUEL)');
        if (connection === 'close') startBot();
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        let esAudio = false;

        if (msg.message.audioMessage) {
            esAudio = true;
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

        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: "Eres Maxor, asistente de Clínica Maxor. Usa emojis (🦷, ✨). Sé breve." },
                        { role: "user", content: text }
                    ]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` } });

                const respuestaIA = res.data.choices[0].message.content;

                if (esAudio) {
                    const textoParaVoz = respuestaIA.replace(/[^\w\sáéíóúÁÉÍÓÚñÑ,.?!¿¡-]/g, '');

                    const command = new SynthesizeSpeechCommand({
                        Text: textoParaVoz,
                        OutputFormat: "mp3",
                        SampleRate: "22050", // Frecuencia ideal para WhatsApp
                        VoiceId: "Miguel", 
                        Engine: "standard" 
                    });

                    const response = await pollyClient.send(command);
                    const chunks = [];
                    for await (const chunk of response.AudioStream) { chunks.push(chunk); }
                    const audioBuffer = Buffer.concat(chunks);

                    await sock.sendMessage(chatId, { 
                        audio: audioBuffer, 
                        mimetype: 'audio/mp4', // Formato más compatible
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
