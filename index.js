const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    downloadContentFromMessage, 
    DisconnectReason,
    BrowseSync 
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- 1. CONFIGURACIÓN DE SERVIDOR PARA RENDER ---
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🚀 Maxor Bot está vivo y operando.');
});

app.listen(port, () => {
    console.log(`📡 Servidor Web escuchando en puerto ${port}`);
});

// --- 2. CONFIGURACIÓN DE IA (GROQ) ---
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

// --- 3. FUNCIONES DE AUDIO ---
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
        console.error("❌ Error transcribiendo:", e.message);
        return null;
    }
}

// --- 4. LÓGICA DE INTELIGENCIA ARTIFICIAL ---
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
    Usa SIEMPRE 1 o 2 emojis (🦷, ✨). Si ya te presentaste, no repitas tu nombre. 
    Planes: Gold $260, Básico $180. Ubicados en Torre Q.`;

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
        return "¡Hola! Soy Maxor. ✨ ¿En qué puedo ayudarte con tu salud bucal hoy? 🦷"; 
    }
}

// --- 5. NÚCLEO DEL BOT (WHATSAPP) ---
async function startBot() {
    // CAMBIO DE NOMBRE DE CARPETA PARA FORZAR QR NUEVO
    const { state, saveCreds } = await useMultiFileAuthState('sesion_render_final_v5');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"], // Identificación compatible
        printQRInTerminal: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("📢 NUEVO CÓDIGO QR GENERADO:");
            console.log(`🔗 ESCANEA AQUÍ: https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Conexión cerrada. ¿Reconectando?:', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ MAXOR ONLINE (IA + AUDIO + N8N READY)');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        const nombreWA = msg.pushName || "Paciente";
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        // Procesar Audio
        if (msg.message.audioMessage) {
            console.log("🎤 Procesando nota de voz...");
            const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
            text = await transcribirAudio(stream);
            console.log(`📝 Transcripción: ${text}`);
        }

        if (text) {
            // Cancelar recordatorio si el usuario responde
            if (temporizadores[chatId]) clearTimeout(temporizadores[chatId]);

            // Obtener respuesta de IA
            const respuesta = await hablarConGroq(chatId, text, nombreWA);
            
            // Enviar respuesta a WhatsApp
            await sock.sendMessage(chatId, { text: respuesta });

            // ENVIAR DATOS A N8N
            try {
                await axios.post("https://luisslam.app.n8n.cloud/webhook-test/test-paciente", {
                    nombre: nombreWA,
                    telefono: chatId.split('@')[0],
                    mensaje_usuario: text,
                    respuesta_maxor: respuesta,
                    tipo: msg.message.audioMessage ? "audio" : "texto"
                });
                console.log("🚀 Datos sincronizados con n8n");
            } catch (e) {
                console.log("⚠️ Error enviando a n8n");
            }

            // Temporizador de seguimiento (30 min)
            temporizadores[chatId] = setTimeout(async () => {
                await sock.sendMessage(chatId, { text: "Estaré por aquí si decides agendar tu cita en Clínica Maxor. ¡Feliz día! 🦷" });
                if(memoria[chatId]) memoria[chatId].historial = []; 
                guardarMemoria();
            }, 30 * 60 * 1000);
        }
    });
}

startBot();
