const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- CONFIGURACIÓN DE APIS ---
const GROQ_API_KEY = "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";
const GEMINI_API_KEY = "AIzaSyDJZbAQEcqsPXHMM7Zmpz8rHF3HPAaHbGE";
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const app = express();
app.get('/', (req, res) => res.send('Maxor Bot Híbrido Activo 🦷'));
app.listen(process.env.PORT || 3000);

let memoria = {};

// --- NUEVA FUNCIÓN DE AUDIO CON GEMINI (Sin errores 401) ---
async function transcribirAudioGemini(stream) {
    const tempFile = `/tmp/audio_${Date.now()}.ogg`;
    try {
        const buffer = [];
        for await (const chunk of stream) buffer.push(chunk);
        fs.writeFileSync(tempFile, Buffer.concat(buffer));

        // Usamos Gemini 1.5 Flash para transcribir
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const audioData = {
            inlineData: {
                data: Buffer.concat(buffer).toString("base64"),
                mimeType: "audio/ogg"
            }
        };

        const result = await model.generateContent([
            "Transcribe exactamente lo que dice este audio en español. Si no hay voz, responde con un espacio vacío.",
            audioData
        ]);

        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        return result.response.text();
    } catch (e) {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        console.error("Error en Gemini Audio:", e.message);
        return null;
    }
}

// --- LÓGICA DE IA CON GROQ (Tu Prompt Original) ---
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
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "system", content: systemPrompt }, ...memoria[chatId].historial],
            temperature: 0.7 
        }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" } });

        const respuesta = res.data.choices[0].message.content;
        memoria[chatId].historial.push({ role: "assistant", content: respuesta });
        return respuesta;
    } catch (e) { return "¡Hola! Soy Maxor. ✨ ¿Cómo puedo ayudarte hoy? 🦷"; }
}

async function startBot() {
    // MANTENEMOS TU SESIÓN PARA NO PERDER EL QR
    const { state, saveCreds } = await useMultiFileAuthState('sesion_qr_nueva_final');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) console.log("QR Link: https://api.qrserver.com/v1/create-qr-code/?data=" + encodeURIComponent(qr));
        if (connection === 'open') console.log('✅ MAXOR HÍBRIDO ONLINE');
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        const nombreWA = msg.pushName || "Paciente";
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        // --- SI ES AUDIO: USA GEMINI ---
        if (msg.message.audioMessage) {
            await sock.sendPresenceUpdate('composing', chatId); 
            console.log("🎤 Audio recibido. Procesando con Gemini...");
            const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
            text = await transcribirAudioGemini(stream);
            console.log(`📝 Gemini transcribió: ${text}`);
        }

        // --- SI HAY TEXTO: RESPONDE CON GROQ ---
        if (text && text.trim().length > 0) {
            const respuesta = await hablarConGroq(chatId, text, nombreWA);
            await sock.sendMessage(chatId, { text: respuesta });

            // ENVÍO A N8N
            try {
                await axios.post("https://themiz97.app.n8n.cloud/webhook-test/test-pacientes", {
                    nombre: nombreWA,
                    telefono: chatId.split('@')[0],
                    mensaje: text,
                    respuesta_ia: respuesta,
                    fuente: msg.message.audioMessage ? "Gemini Audio" : "Groq Texto"
                });
            } catch (e) { console.log("n8n offline"); }
        }
    });
}

startBot();
