const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');
const gTTS = require('gtts'); 

const app = express();
app.get('/', (req, res) => res.send('Maxor Bot Pro: Online 🦷'));
app.listen(process.env.PORT || 3000);

const GROQ_API_KEY = "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";

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_voz_v5');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Mac OS", "Safari", "17.0"],
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection } = update;
        if (connection === 'open') console.log('✅ MAXOR FUNCIONANDO SIN EMOJIS EN VOZ');
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        let esAudio = false;

        const systemPrompt = `Eres Maxor, asistente de Clínica Maxor. Director: Dr. Orlando Reyes. Sé breve y profesional. Usa emojis al final del texto.`;

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

        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" } });

                const respuestaIA = res.data.choices[0].message.content;

                if (esAudio) {
                    // --- LIMPIEZA DE EMOJIS PARA EL AUDIO ---
                    // Esta línea quita los emojis para que la IA no diga "diente"
                    const textoLimpioParaVoz = respuestaIA.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F400}-\u{1F4FF}]/gu, '');

                    const pathAudioRespuesta = `/tmp/res_${Date.now()}.mp3`;
                    const gtts = new gTTS(textoLimpioParaVoz, 'es-us');
                    
                    gtts.save(pathAudioRespuesta, async function (err) {
                        if (err) return sock.sendMessage(chatId, { text: respuestaIA });
                        
                        // Enviamos con mimetype corregido para que el paciente pueda escucharlo
                        await sock.sendMessage(chatId, { 
                            audio: { url: pathAudioRespuesta }, 
                            mimetype: 'audio/mpeg', 
                            ptt: true 
                        });
                        
                        // Esperamos un poco antes de borrar para que WhatsApp termine de subirlo
                        setTimeout(() => { if (fs.existsSync(pathAudioRespuesta)) fs.unlinkSync(pathAudioRespuesta); }, 5000);
                    });
                } else {
                    await sock.sendMessage(chatId, { text: respuestaIA });
                }

            } catch (e) { console.error("Error en proceso"); }
        }
    });
}

startBot();
