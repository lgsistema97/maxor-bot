const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- 1. SERVIDOR PARA RENDER ---
const app = express();
app.get('/', (req, res) => res.send('Maxor Bot Online 🦷'));
app.listen(process.env.PORT || 3000);

// --- 2. CONFIGURACIÓN DE API ---
const GROQ_API_KEY = "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";

async function startBot() {
    // Sesión actualizada para aplicar cambios
    const { state, saveCreds } = await useMultiFileAuthState('sesion_maxor_final_v4');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Mac OS", "Safari", "17.0"],
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log("📢 ESCANEA ESTE QR:");
            console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`);
        }
        if (connection === 'open') console.log('✅ MAXOR CONECTADO EXITOSAMENTE');
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.remoteJid;
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        // PROMPT PERSONALIZADO CON TODA LA INFORMACIÓN
        const systemPrompt = `Eres Maxor, asistente virtual exclusivo de la Clínica Maxilofacial Maxor en El Hatillo. 

INFORMACIÓN DEL DOCTOR:
- Director Médico: Dr. Orlando Reyes Rodríguez.
- Especialidad: Cirujano Bucal y Maxilofacial (egresado de la UNAM, México, 2009). 
- Experiencia: Experto en cirugía ortognática, implantes dentales, reconstrucción maxilofacial y rehabilitación compleja.
- Compromiso Social: Lidera la Fundación Maxor y el proyecto educativo EduMaxor, ayudando a pacientes con labio y paladar hendido.

SOBRE LA CLÍNICA:
- Ubicación: Torre Q, El Hatillo, Caracas. Web: inversionesmaxor.com
- Servicios: Cordales, implantes, estética facial, traumatismos y patología maxilofacial.
- Planes: Plan Gold ($260) y Plan Básico ($180).

REGLAS DE IDENTIDAD Y COMPORTAMIENTO:
1. Tu nombre es Maxor. No menciones NUNCA que eres una IA, ni a Meta, Llama o Groq.
2. Si preguntan por tu tecnología, di con amabilidad que eres el asistente de la clínica entrenado para ayudar a los pacientes de Maxor.
3. Solo respondes dudas sobre la clínica y el Dr. Orlando Reyes. Si preguntan cosas ajenas, di: "Solo puedo asistirte con información relacionada a la Clínica Maxor y salud bucal. ¿Cómo puedo ayudarte hoy? 🦷✨"
4. Estilo: Profesional, empático y breve. Usa 1 o 2 emojis (🦷, ✨).`;

        // --- MANEJO DE AUDIO (WHISPER) ---
        if (msg.message.audioMessage) {
            await sock.sendPresenceUpdate('composing', chatId);
            const tempFile = `/tmp/audio_${Date.now()}.ogg`;
            try {
                const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
                const buffer = [];
                for await (const chunk of stream) buffer.push(chunk);
                fs.writeFileSync(tempFile, Buffer.concat(buffer));

                const formData = new FormData();
                formData.append('file', fs.createReadStream(tempFile));
                formData.append('model', 'whisper-large-v3');

                const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
                    headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${GROQ_API_KEY}` }
                });
                text = res.data.text;
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            } catch (e) {
                if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
            }
        }

        // --- RESPUESTA DE CHAT ---
        if (text) {
            try {
                const res = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: text }
                    ]
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" } });

                const respuestaIA = res.data.choices[0].message.content;
                await sock.sendMessage(chatId, { text: respuestaIA });

                // Envío a n8n
                axios.post("https://themiz97.app.n8n.cloud/webhook-test/test-pacientes", {
                    nombre: msg.pushName || "Paciente",
                    mensaje: text,
                    respuesta: respuestaIA,
                    doctor: "Dr. Orlando Reyes Rodríguez"
                }).catch(() => {});
            } catch (e) { console.error("Error Groq"); }
        }
    });
}

startBot();
