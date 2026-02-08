const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- 1. SERVIDOR PARA EVITAR QUE RENDER SE APAGUE ---
const app = express();
app.get('/', (req, res) => res.send('Maxor Bot Online 🦷'));
app.listen(process.env.PORT || 3000);

// --- 2. CONFIGURACIÓN DE TU NUEVA API KEY ---
const GROQ_API_KEY = "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";

async function startBot() {
    // CAMBIO DE NOMBRE DE SESIÓN: Esto garantiza que te dé un QR nuevo
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_final_v3');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Mac OS", "Safari", "17.0"], // Identidad estable para evitar bloqueos
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // Si hay un QR nuevo, te dará el link en los logs
        if (qr) {
            console.log("📢 ESCANEA ESTE QR NUEVO:");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
        }

        if (connection === 'open') {
            console.log('✅ MAXOR CONECTADO Y LISTO');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        // --- 3. PROCESAMIENTO DE AUDIO (USANDO WHISPER EN GROQ) ---
        if (msg.message.audioMessage) {
            await sock.sendPresenceUpdate('composing', chatId);
            const tempFile = `/tmp/audio_${Date.now()}.ogg`; // Carpeta temporal permitida en Render
            try {
                const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
                const buffer = [];
                for await (const chunk of stream) buffer.push(chunk);
                fs.writeFileSync(tempFile, Buffer.concat(buffer));

                const formData = new FormData();
                formData.append('file', fs.createReadStream(tempFile));
                formData.append('model', 'whisper-large-v3');

                const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
                    headers: { 
                        ...formData.getHeaders(),
                        'Authorization': `Bearer ${GROQ_API_KEY.trim()}` 
                    }
                });
                text = res.data.text;
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            } catch (e) { 
                console.error("Error transcribiendo audio:", e.message);
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            }
        }

        // --- 4. RESPUESTA DE LA IA (USANDO GROQ LLAMA 3) ---
        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: "Eres Maxor, asistente amigable de Clínica Maxilofacial Maxor en El Hatillo. Usa emojis 🦷✨. Respuesta corta." },
                        { role: "user", content: text }
                    ]
                }, { 
                    headers: { 
                        "Authorization": `Bearer ${GROQ_API_KEY.trim()}`,
                        "Content-Type": "application/json"
                    } 
                });
                
                const respuestaIA = res.data.choices[0].message.content;
                await sock.sendMessage(chatId, { text: respuestaIA });

                // --- 5. ENVÍO A TU WEBHOOK DE N8N ---
                axios.post("https://themiz97.app.n8n.cloud/webhook-test/test-pacientes", {
                    nombre: msg.pushName || "Paciente",
                    mensaje: text,
                    respuesta: respuestaIA
                }).catch(() => {});

            } catch (e) { 
                console.error("Error en Groq Chat:", e.response?.data || e.message);
            }
        }
    });
}

startBot();
