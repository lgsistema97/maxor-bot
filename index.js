const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express'); // Necesario para Render

// --- SERVIDOR PARA RENDER (Evita que el bot se apague) ---
const app = express();
app.get('/', (req, res) => res.send('Bot de Clínica Maxor está activo 🦷'));
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

// --- FUNCIÓN PARA TRANSCRIPCIÓN DE AUDIOS ---
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
        console.error("Error en audio:", e.message);
        return null;
    }
}

// --- LÓGICA DE IA (GROQ) ---
async function hablarConGroq(chatId, textoUsuario, nombreWhatsApp) {
    if (!memoria[chatId]) {
        memoria[chatId] = { 
            historial: [], 
            datosPaciente: { nombre: nombreWhatsApp, especialidad: "No definida" } 
        };
    }
    
    memoria[chatId].historial.push({ role: "user", content: textoUsuario });
    if (memoria[chatId].historial.length > 12) memoria[chatId].historial.shift();

    const systemPrompt = `Eres Maxor, asistente de Clínica Maxilofacial Maxor en El Hatillo. 
    Usa emojis 🦷✨. Planes: Gold $260, Básico $180. Ubicados en Torre Q.`;

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

// --- INICIO DEL BOT ---
async function startBot() {
    // IMPORTANTE: Cambiamos el nombre de la carpeta para limpiar errores previos
    const { state, saveCreds } = await useMultiFileAuthState('auth_session_render');
    
    const sock = makeWASocket({ 
        auth: state, 
        logger: pino({ level: "silent" }),
        // SOLUCIÓN AL ERROR DE QR: Usar un navegador real conocido
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        printQRInTerminal: true 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log("📢 ESCANEA ESTE LINK:");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ MAXOR ONLINE (WHATSAPP + IA + N8N)');
        }
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

            // ENVÍO A TU WEBHOOK ACTUALIZADO
            try {
                await axios.post("https://themiz97.app.n8n.cloud/webhook-test/test-pacientes", {
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
