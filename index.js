const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- 1. SERVIDOR PARA RENDER (INDISPENSABLE) ---
const app = express();
app.get('/', (req, res) => res.send('Maxor Bot Online 🦷'));
app.listen(process.env.PORT || 3000);

const GROQ_API_KEY = "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";
const MODELO = "llama-3.3-70b-versatile";

let memoria = {};
let temporizadores = {};

// --- 2. FUNCIÓN DE AUDIO CORREGIDA (PARA RENDER) ---
async function transcribirAudio(stream) {
    // Usamos /tmp/ porque Render bloquea la escritura en otras carpetas
    const tempFile = `/tmp/audio_${Date.now()}.ogg`;
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
        console.error("Error en Whisper:", e.message);
        return null;
    }
}

// --- 3. LÓGICA DE IA CON TU PROMPT ORIGINAL ---
async function hablarConGroq(chatId, textoUsuario, nombreWhatsApp) {
    if (!memoria[chatId]) {
        memoria[chatId] = { historial: [], datosPaciente: { nombre: nombreWhatsApp } };
    }
    memoria[chatId].historial.push({ role: "user", content: textoUsuario });
    if (memoria[chatId].historial.length > 10) memoria[chatId].historial.shift();

    const systemPrompt = `Eres Maxor, asistente de Clínica Maxilofacial Maxor en El Hatillo.
    REGLA DE ESTILO: Usa SIEMPRE 1 o 2 emojis por respuesta (🦷, ✨).
    REGLA DE ORO: Si ya te presentaste, NO repitas tu nombre.
    INFORMACIÓN: Plan Gold ($260), Plan Básico ($180). Ubicados en Torre Q.`;

    try {
        const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: MODELO,
            messages: [{ role: "system", content: systemPrompt }, ...memoria[chatId].historial],
            temperature: 0.7 
        }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" } });

        const respuesta = res.data.choices[0].message.content;
        memoria[chatId].historial.push({ role: "assistant", content: respuesta });
        return respuesta;
    } catch (e) { return "¡Hola! Soy Maxor. ✨ ¿Cómo puedo ayudarte hoy? 🦷"; }
}

// --- 4. INICIO DEL BOT ---
async function startBot() {
    // IMPORTANTE: Mantenemos el nombre de tu sesión actual para NO perder el QR
    const { state, saveCreds } = await useMultiFileAuthState('sesion_qr_nueva_final');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log("📢 El QR se cerró inesperadamente. Escanea de nuevo:");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
        }
        if (connection === 'open') {
            console.log('✅ MAXOR ONLINE - SESIÓN RECUPERADA');
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
        const nombreWA = msg.pushName || "Paciente";
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        // --- PROCESAR AUDIO ---
        if (msg.message.audioMessage) {
            // Indicamos que el bot está procesando
            await sock.sendPresenceUpdate('composing', chatId); 
            console.log("🎤 Audio recibido, transcribiendo...");
            const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
            text = await transcribirAudio(stream);
            console.log(`📝 Transcripción: ${text}`);
        }

        if (text) {
            const respuesta = await hablarConGroq(chatId, text, nombreWA);
            await sock.sendMessage(chatId, { text: respuesta });

            // --- ENVÍO A TU WEBHOOK DE N8N ---
            try {
                await axios.post("https://themiz97.app.n8n.cloud/webhook-test/test-pacientes", {
                    nombre: nombreWA,
                    telefono: chatId.split('@')[0],
                    mensaje: text,
                    respuesta_ia: respuesta,
                    tipo: msg.message.audioMessage ? "audio" : "texto"
                });
            } catch (e) { console.log("n8n test offline"); }
        }
    });
}

startBot();
