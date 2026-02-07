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

// --- 1. SERVIDOR EXPRESS PARA RENDER ---
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🚀 Maxor Bot está operando en la nube.');
});

app.listen(port, () => {
    console.log(`📡 Puerto activo: ${port}`);
});

// --- 2. CONFIGURACIÓN IA (GROQ) ---
const GROQ_API_KEY = "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";
const MODELO = "llama-3.3-70b-versatile";

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

// --- 3. TRANSCRIPCIÓN DE AUDIO ---
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
            headers: { 
                ...formData.getHeaders(), 
                'Authorization': `Bearer ${GROQ_API_KEY}` 
            }
        });

        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        return res.data.text;
    } catch (e) {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        console.error("❌ Error Audio:", e.message);
        return null;
    }
}

// --- 4. FUNCIÓN IA ---
async function hablarConGroq(chatId, textoUsuario, nombreWhatsApp) {
    if (!memoria[chatId]) {
        memoria[chatId] = { 
            historial: [], 
            datosPaciente: { nombre: nombreWhatsApp } 
        };
    }
    
    memoria[chatId].historial.push({ role: "user", content: textoUsuario });
    if (memoria[chatId].historial.length > 12) memoria[chatId].historial.shift();

    const systemPrompt = `Eres Maxor, asistente de Clínica Maxilofacial Maxor en El Hatillo. 🦷
    Usa emojis ✨. Responde brevemente.
    Precios: Plan Gold $260, Básico $180.`;

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
    } catch (e) { 
        return "¡Hola! ✨ ¿En qué puedo ayudarte hoy en Clínica Maxor? 🦷"; 
    }
}

// --- 5. LÓGICA PRINCIPAL DEL BOT ---
async function startBot() {
    // Usamos una carpeta de sesión única para evitar el error de vinculación
    const { state, saveCreds } = await useMultiFileAuthState('sesion_render_final_v6');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        printQRInTerminal: true,
        connectTimeoutMs: 60000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("📢 ESCANEA ESTE QR PARA CONECTAR:");
            console.log(`🔗 LINK DIRECTO: https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ CONECTADO EXITOSAMENTE A WHATSAPP');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        const nombreWA = msg.pushName || "Paciente";
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        // Si es audio
        if (msg.message.audioMessage) {
            const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
            text = await transcribirAudio(stream);
        }

        if (text) {
            if (temporizadores[chatId]) clearTimeout(temporizadores[chatId]);

            const respuesta = await hablarConGroq(chatId, text, nombreWA);
            await sock.sendMessage(chatId, { text: respuesta });

            // --- ENVÍO A TU NUEVO WEBHOOK DE N8N ---
            try {
                await axios.post("https://themiz97.app.n8n.cloud/webhook-test/test-pacientes", {
                    nombre: nombreWA,
                    telefono: chatId.split('@')[0],
                    mensaje_usuario: text,
                    respuesta_ia: respuesta,
                    tipo: msg.message.audioMessage ? "audio" : "texto"
                });
                console.log("🚀 Datos enviados a n8n");
            } catch (e) {
                console.log("⚠️ n8n no recibió los datos (revisa si el Test está activo)");
            }

            // Seguimiento automático
            temporizadores[chatId] = setTimeout(async () => {
                await sock.sendMessage(chatId, { text: "Estaré por aquí si decides agendar tu cita en Clínica Maxor. ✨🦷" });
                if(memoria[chatId]) memoria[chatId].historial = []; 
                guardarMemoria();
            }, 45 * 60 * 1000);
        }
    });
}

startBot();
