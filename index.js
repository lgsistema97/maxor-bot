const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// SERVIDOR PARA QUE RENDER NO SE APAGUE
const app = express();
app.get('/', (req, res) => res.send('Maxor Bot Activo 🦷'));
app.listen(process.env.PORT || 3000);

const GROQ_API_KEY = "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";
const MODELO = "llama-3.3-70b-versatile";

let memoria = {};
let temporizadores = {};

// FUNCIÓN AUDIOS (WHISPER)
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

// IA CON TU PROMPT
async function hablarConGroq(chatId, textoUsuario, nombreWhatsApp) {
    if (!memoria[chatId]) {
        memoria[chatId] = { historial: [], datosPaciente: { nombre: nombreWhatsApp } };
    }
    memoria[chatId].historial.push({ role: "user", content: textoUsuario });
    const systemPrompt = `Eres Maxor, asistente de Clínica Maxilofacial Maxor en El Hatillo.
    REGLA DE ESTILO: Usa SIEMPRE 1 o 2 emojis por respuesta (🦷, ✨).
    REGLA DE ORO: Si ya te presentaste, NO repitas tu nombre.
    INFORMACIÓN: Plan Gold ($260), Plan Básico ($180). Ubicados en Torre Q.`;

    try {
        const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: MODELO,
            messages: [{ role: "system", content: systemPrompt }, ...memoria[chatId].historial.slice(-10)],
            temperature: 0.7 
        }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` } });
        const respuesta = res.data.choices[0].message.content;
        memoria[chatId].historial.push({ role: "assistant", content: respuesta });
        return respuesta;
    } catch (e) { return "¡Hola! Soy Maxor. ✨ ¿Cómo puedo ayudarte hoy? 🦷"; }
}

async function startBot() {
    // CAMBIO DE NOMBRE DE SESIÓN PARA LIMPIAR EL QR
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_fria_v1');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"], // Identidad estable
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log("📢 ESCANEA ESTE QR:");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ MAXOR ONLINE - ESCUCHANDO TEXTO Y AUDIO');
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
            
            // ENVÍO A N8N
            try {
                await axios.post("https://themiz97.app.n8n.cloud/webhook-test/test-pacientes", {
                    nombre: msg.pushName || "Paciente",
                    mensaje: text,
                    respuesta: respuesta
                });
            } catch (e) {}
        }
    });
}

startBot();
