const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- SERVIDOR PARA RENDER (INDISPENSABLE) ---
const app = express();
app.get('/', (req, res) => res.send('Maxor Bot Online 🦷'));
app.listen(process.env.PORT || 3000);

const GROQ_API_KEY = "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";
const MODELO = "llama-3.3-70b-versatile";

// --- GESTIÓN DE MEMORIA ---
let memoria = {};
if (fs.existsSync('./memoria.json')) {
    try {
        memoria = JSON.parse(fs.readFileSync('./memoria.json', 'utf-8'));
    } catch (e) { memoria = {}; }
}

function guardarMemoria() {
    fs.writeFileSync('./memoria.json', JSON.stringify(memoria, null, 2));
}

let temporizadores = {};

// --- FUNCIÓN PARA ESCUCHAR AUDIOS (WHISPER) ---
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
        console.error("Error procesando audio:", e);
        return null;
    }
}

// --- LÓGICA DE IA CON TU PROMPT ORIGINAL ---
async function hablarConGroq(chatId, textoUsuario, nombreWhatsApp) {
    if (!memoria[chatId]) {
        memoria[chatId] = { 
            historial: [], 
            datosPaciente: { nombre: nombreWhatsApp, especialidad: "No definida" } 
        };
    }
    
    memoria[chatId].historial.push({ role: "user", content: textoUsuario });
    if (memoria[chatId].historial.length > 12) memoria[chatId].historial.shift();

    // TU PROMPT ORIGINAL MANTENIDO
    const systemPrompt = `Eres Maxor, asistente de Clínica Maxilofacial Maxor en El Hatillo.
    REGLA DE ESTILO: Usa SIEMPRE 1 o 2 emojis por respuesta (🦷, ✨).
    REGLA DE ORO: Si ya te presentaste, NO repitas tu nombre.
    INFORMACIÓN: Plan Gold ($260), Plan Básico ($180). Ubicados en Torre Q.
    CONTEXTO: El usuario puede hablarte por texto o por NOTA DE VOZ.`;

    try {
        const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
            model: MODELO,
            messages: [{ role: "system", content: systemPrompt }, ...memoria[chatId].historial],
            temperature: 0.7 
        }, {
            headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" }
        });

        const respuesta = res.data.choices[0].message.content;
        memoria[chatId].historial.push({ role: "assistant", content: respuesta });
        guardarMemoria();
        return respuesta;
    } catch (e) { return "¡Hola! Soy Maxor. ✨ ¿Cómo puedo ayudarte hoy? 🦷"; }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_fria_v1');
    const sock = makeWASocket({ 
        auth: state, 
        logger: pino({ level: "silent" }), 
        browser: ["Ubuntu", "Chrome", "20.0.04"] 
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) {
            console.log("📢 ESCANEA AQUÍ:");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
        }
        if (connection === 'open') console.log('✅ MAXOR ONLINE (TEXTO + AUDIOS + N8N)');
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        const nombreWA = msg.pushName || "Paciente";
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        // --- LÓGICA DE AUDIO (MANTENIDA) ---
        if (msg.message.audioMessage) {
            console.log("🎤 Recibida nota de voz, transcribiendo...");
            const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
            text = await transcribirAudio(stream);
        }

        if (text) {
            if (temporizadores[chatId]) clearTimeout(temporizadores[chatId]);

            const respuesta = await hablarConGroq(chatId, text, nombreWA);
            await sock.sendMessage(chatId, { text: respuesta });

            // --- ENVÍO A TU WEBHOOK DE N8N ---
            try {
                await axios.post("https://themiz97.app.n8n.cloud/webhook-test/test-pacientes", {
                    nombre: nombreWA,
                    telefono: chatId.split('@')[0],
                    mensaje: text,
                    respuesta_ia: respuesta,
                    es_audio: !!msg.message.audioMessage
                });
            } catch (e) { console.log("n8n test offline"); }

            temporizadores[chatId] = setTimeout(async () => {
                await sock.sendMessage(chatId, { text: "Veo que no has podido continuar la conversación. ✨ Estaré por aquí si decides agendar tu cita en Clínica Maxor. ¡Feliz día! 🦷" });
                if(memoria[chatId]) memoria[chatId].historial = []; 
                guardarMemoria();
            }, 30 * 60 * 1000);
        }
    });
}

startBot();
