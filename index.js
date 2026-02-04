const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express'); // NUEVO PARA RENDER

// --- SERVIDOR PARA RENDER ---
const app = express();
app.get('/', (req, res) => res.send('Maxor Bot Online 🦷'));
app.listen(process.env.PORT || 3000);

const GROQ_API_KEY = "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";
const MODELO = "llama-3.3-70b-versatile";

let memoria = {};
if (fs.existsSync('./memoria.json')) {
    try { memoria = JSON.parse(fs.readFileSync('./memoria.json', 'utf-8')); } catch (e) { memoria = {}; }
}

function guardarMemoria() { fs.writeFileSync('./memoria.json', JSON.stringify(memoria, null, 2)); }
let temporizadores = {};

async function transcribirAudio(stream) {
    const tempFile = `./audio_${Date.now()}.ogg`;
    try {
        const buffer = [];
        for await (const chunk of stream) buffer.push(chunk);
        fs.writeFileSync(tempFile, Buffer.concat(buffer));
        const formData = new FormData();
        formData.append('file', fs.createReadStream(tempFile));
        formData.append('model', 'whisper-large-v3');
        formData.append('language', 'es');
        const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${GROQ_API_KEY}` }
        });
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        return res.data.text;
    } catch (e) {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        return null;
    }
}

async function hablarConGroq(chatId, textoUsuario, nombreWhatsApp) {
    if (!memoria[chatId]) {
        memoria[chatId] = { historial: [], datosPaciente: { nombre: nombreWhatsApp, especialidad: "No definida" } };
    }
    memoria[chatId].historial.push({ role: "user", content: textoUsuario });
    if (memoria[chatId].historial.length > 12) memoria[chatId].historial.shift();

    const systemPrompt = `Eres Maxor, asistente de Clínica Maxilofacial Maxor. Usa emojis 🦷.`;

    try {
        const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: MODELO,
            messages: [{ role: "system", content: systemPrompt }, ...memoria[chatId].historial],
            temperature: 0.7 
        }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` } });
        
        const respuesta = res.data.choices[0].message.content;
        memoria[chatId].historial.push({ role: "assistant", content: respuesta });
        guardarMemoria();
        return respuesta;
    } catch (e) { return "¡Hola! Soy Maxor. ✨ ¿Cómo puedo ayudarte? 🦷"; }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_render'); // Cambiado para Render
    const sock = makeWASocket({ auth: state, logger: pino({ level: "silent" }), browser: ["Maxor Bot", "Chrome", "1.0.0"] });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) {
            console.log("🔗 ESCANEA EL QR AQUÍ:");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
        }
        if (connection === 'open') console.log('✅ MAXOR ONLINE');
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        const nombreWA = msg.pushName || "Paciente";
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (msg.message.audioMessage) {
            const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
            text = await transcribirAudio(stream);
        }

        if (text) {
            const respuesta = await hablarConGroq(chatId, text, nombreWA);
            await sock.sendMessage(chatId, { text: respuesta });

            // --- ENVÍO A N8N ---
            try {
                await axios.post("https://luisslam.app.n8n.cloud/webhook-test/test-paciente", {
                    nombre: nombreWA,
                    telefono: chatId.split('@')[0],
                    mensaje: text,
                    respuesta_ia: respuesta
                });
            } catch (e) { console.log("Error n8n"); }
        }
    });
}
startBot();
