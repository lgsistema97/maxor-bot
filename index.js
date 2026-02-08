const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const { PollyClient, SynthesizeSpeechCommand } = require("@aws-sdk/client-polly");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- SERVIDOR PARA RENDER ---
const app = express();
app.get('/', (req, res) => res.send('Maxor Bot con Voz de Pedro AWS Online 🦷'));
app.listen(process.env.PORT || 3000);

// --- CONFIGURACIÓN DE LLAVES ---
const GROQ_API_KEY = "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";
const AWS_CONFIG = {
    region: "us-east-2", // Ohio, según tu consola AWS
    credentials: {
        accessKeyId: "AKIAWIMAFPKT4HMOM5UD",
        secretAccessKey: "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"
    }
};

const pollyClient = new PollyClient(AWS_CONFIG);

async function startBot() {
    // Nueva sesión para asegurar conexión limpia
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_aws_pedro');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Maxor AWS", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) {
            console.log("📢 ESCANEA EL QR PARA ACTIVAR A PEDRO:");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
        }
        if (connection === 'open') {
            console.log('✅ MAXOR CONECTADO CON VOZ DE PEDRO (AWS)');
        }
        if (connection === 'close') {
            startBot();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        let esAudio = false;

        // Prompt de personalidad
        const systemPrompt = `Eres Maxor, asistente de la Clínica Maxor del Dr. Orlando Reyes. 
        REGLA: En tus respuestas escritas usa 2 o 3 emojis (🦷, ✨). 
        En los audios sé breve, amable y profesional. No menciones que eres una IA.`;

        // --- 1. TRANSCRIPCIÓN DE AUDIO (WHISPER) ---
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
            } catch (e) { 
                console.error("Error Whisper:", e.message);
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            }
        }

        // --- 2. RESPUESTA E INTELIGENCIA ---
        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: text }
                    ]
                }, { 
                    headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" } 
                });

                const respuestaIA = res.data.choices[0].message.content;

                if (esAudio) {
                    // Limpieza para que Polly no lea los emojis
                    const textoParaVoz = respuestaIA.replace(/[^\w\sáéíóúÁÉÍÓÚñÑ,.?!¿¡-]/g, '');

                    // LLAMADA A AMAZON POLLY (PEDRO NEURAL)
                    const command = new SynthesizeSpeechCommand({
                        Text: textoParaVoz,
                        OutputFormat: "mp3",
                        VoiceId: "Pedro", 
                        Engine: "neural"    
                    });

                    const response = await pollyClient.send(command);
                    
                    // Convertir stream de AWS a Buffer
                    const chunks = [];
                    for await (const chunk of response.AudioStream) { chunks.push(chunk); }
                    const audioBuffer = Buffer.concat(chunks);

                    await sock.sendMessage(chatId, { 
                        audio: audioBuffer, 
                        mimetype: 'audio/mp4', 
                        ptt: true 
                    });
                } else {
                    // Envío de texto normal con emojis
                    await sock.sendMessage(chatId, { text: respuestaIA });
                }

                // Webhook opcional para n8n
                axios.post("https://themiz97.app.n8n.cloud/webhook-test/test-pacientes", {
                    nombre: msg.pushName || "Paciente",
                    mensaje: text,
                    respuesta: respuestaIA
                }).catch(() => {});

            } catch (e) { 
                console.error("Error Proceso:", e.message);
            }
        }
    });
}

startBot();
