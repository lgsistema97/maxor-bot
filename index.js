const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');
const { MsEdgeTTS } = require("edge-tts"); // Voz de Microsoft (Gratis y Humana)

const app = express();
app.get('/', (req, res) => res.send('Maxor Bot Voz Pro: Online 🦷'));
app.listen(process.env.PORT || 3000);

const GROQ_API_KEY = "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";

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_final_v3');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Maxor Bot", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) console.log("Link QR: https://api.qrserver.com/v1/create-qr-code/?data=" + encodeURIComponent(qr));
        if (connection === 'open') console.log('✅ MAXOR CON VOZ HUMANA GRATUITA CONECTADO');
        if (connection === 'close') startBot();
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        let esAudio = false;

        const systemPrompt = `Eres Maxor, asistente de la Clínica Maxor. Director: Dr. Orlando Reyes Rodríguez. 
        REGLA DE ORO: En tus respuestas escritas DEBES usar siempre 2 o 3 emojis (🦷, ✨, 🪥).
        Sé breve, amable y profesional.`;

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
                    headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${GROQ_API_KEY.trim()}` }
                });
                text = res.data.text;
                fs.unlinkSync(tempFile);
            } catch (e) { console.log("Error en transcripción"); }
        }

        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY.trim()}` } });

                const respuestaIA = res.data.choices[0].message.content;

                if (esAudio) {
                    // Limpieza total de emojis para que no los lea
                    const textoVoz = respuestaIA.replace(/[^\w\sáéíóúÁÉÍÓÚñÑ,.?!¿¡-]/g, '');
                    const pathAudio = `/tmp/res_${Date.now()}.mp3`;
                    
                    const tts = new MsEdgeTTS();
                    // Usamos la voz "Jorge", que es masculina, pausada y muy real
                    await tts.setMetadata("es-MX-JorgeNeural", "outputformat-24khz-48kbitrate-mono-mp3");
                    
                    await tts.toFile(pathAudio, textoVoz);
                    
                    // Enviamos el audio y luego lo borramos del servidor
                    await sock.sendMessage(chatId, { 
                        audio: { url: pathAudio }, 
                        mimetype: 'audio/mp4', 
                        ptt: true 
                    });
                    
                    setTimeout(() => { if (fs.existsSync(pathAudio)) fs.unlinkSync(pathAudio); }, 10000);
                } else {
                    await sock.sendMessage(chatId, { text: respuestaIA });
                }
            } catch (e) { console.error("Error en proceso de respuesta"); }
        }
    });
}
startBot();
