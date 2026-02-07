const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    downloadContentFromMessage, 
    DisconnectReason 
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- SERVIDOR PARA RENDER ---
const app = express();
app.get('/', (req, res) => res.send('Bot Maxor Activo 🦷'));
app.listen(process.env.PORT || 3000);

const GROQ_API_KEY = "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";
const MODELO = "llama-3.3-70b-versatile";

// Memoria y Funciones (Mantenemos tu lógica original)
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
        memoria[chatId] = { historial: [], datosPaciente: { nombre: nombreWhatsApp } };
    }
    memoria[chatId].historial.push({ role: "user", content: textoUsuario });
    const systemPrompt = `Eres Maxor, asistente de Clínica Maxilofacial Maxor. Usa emojis 🦷.`;
    try {
        const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: MODELO,
            messages: [{ role: "system", content: systemPrompt }, ...memoria[chatId].historial.slice(-10)],
            temperature: 0.7 
        }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` } });
        const respuesta = res.data.choices[0].message.content;
        memoria[chatId].historial.push({ role: "assistant", content: respuesta });
        guardarMemoria();
        return respuesta;
    } catch (e) { return "¡Hola! Soy Maxor. ✨ ¿Cómo puedo ayudarte? 🦷"; }
}

// --- FUNCIÓN DE INICIO CON PARÁMETROS ANTIBLOQUEO ---
async function startBot() {
    // 1. Forzamos una sesión limpia con nombre nuevo
    const { state, saveCreds } = await useMultiFileAuthState('session_fix_v7');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        // 2. Usamos una identidad de Chrome en Windows (muy estable)
        browser: ["Windows", "Chrome", "110.0.5481.178"],
        printQRInTerminal: true,
        // 3. Ajustes de tiempo para evitar el error de "Conexión a internet"
        connectTimeoutMs: 90000, // 90 segundos de espera
        keepAliveIntervalMs: 30000,
        defaultQueryTimeoutMs: 0
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log("📢 ESCANEA ESTE QR (NUEVO INTENTO):");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log(`❌ Conexión cerrada. Código: ${code}`);
            // Solo reconectar si no fue un cierre voluntario
            if (code !== DisconnectReason.loggedOut) {
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ ¡CONEXIÓN EXITOSA! Maxor está en línea.');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const chatId = msg.key.remoteJid;
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        if (msg.message.audioMessage) {
            const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
            text = await transcribirAudio(stream);
        }

        if (text) {
            const respuesta = await hablarConGroq(chatId, text, msg.pushName || "Paciente");
            await sock.sendMessage(chatId, { text: respuesta });
            try {
                await axios.post("https://themiz97.app.n8n.cloud/webhook-test/test-pacientes", {
                    nombre: msg.pushName || "Paciente",
                    telefono: chatId.split('@')[0],
                    mensaje: text,
                    respuesta_ia: respuesta
                });
            } catch (e) { console.log("n8n offline"); }
        }
    });
}

startBot();
