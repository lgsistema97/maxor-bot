const { default: makeWASocket, useMultiFileAuthState, downloadContentFromMessage, DisconnectReason, delay } = require("@whiskeysockets/baileys");
const pino = require("pino");
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const express = require('express');

// --- SERVIDOR PARA RENDER ---
const app = express();
app.get('/', (req, res) => res.send('Maxor Bot Activo 🦷'));
app.listen(process.env.PORT || 3000);

const GROQ_API_KEY = "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";
const MODELO = "llama-3.3-70b-versatile";

// ⚠️ COLOCA TU NÚMERO AQUÍ (Con código de país, sin el +)
const MI_NUMERO = "58412XXXXXXX"; 

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesion_por_codigo');
    
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        // Esto le dice a WhatsApp que somos un navegador Chrome normal
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        printQRInTerminal: false 
    });

    // --- LÓGICA DE CÓDIGO DE VINCULACIÓN ---
    if (!sock.authState.creds.registered) {
        console.log(`\n\n📢 GENERANDO CÓDIGO PARA: ${4243835271}`);
        await delay(5000); // Esperar a que el sistema esté listo
        const code = await sock.requestPairingCode(4243835271);
        console.log(`\n\n✅ TU CÓDIGO ES: ${code}\n\n`);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ ¡CONECTADO CON ÉXITO!');
        }
    });

    // --- TU LÓGICA DE IA Y AUDIOS (YA INCLUIDA) ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        let text = msg.message.conversation || msg.message.extendedTextMessage?.text;

        // Si es audio, lo transcribimos
        if (msg.message.audioMessage) {
            try {
                const stream = await downloadContentFromMessage(msg.message.audioMessage, 'audio');
                const buffer = [];
                for await (const chunk of stream) buffer.push(chunk);
                const tempFile = `./audio_${Date.now()}.ogg`;
                fs.writeFileSync(tempFile, Buffer.concat(buffer));
                
                const formData = new FormData();
                formData.append('file', fs.createReadStream(tempFile));
                formData.append('model', 'whisper-large-v3');
                
                const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
                    headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${GROQ_API_KEY}` }
                });
                text = res.data.text;
                fs.unlinkSync(tempFile);
            } catch (e) { console.log("Error audio"); }
        }

        if (text) {
            // Llama a Groq y responde
            try {
                const resGroq = await axios.post("https://api.groq.com/openai/v1/chat/completions", {
                    model: MODELO,
                    messages: [{ role: "system", content: "Eres Maxor, asistente dental. ✨🦷" }, { role: "user", content: text }],
                }, { headers: { "Authorization": `Bearer ${GROQ_API_KEY}` } });
                
                const respuesta = resGroq.data.choices[0].message.content;
                await sock.sendMessage(chatId, { text: respuesta });

                // Enviar a n8n
                await axios.post("https://themiz97.app.n8n.cloud/webhook-test/test-pacientes", {
                    nombre: msg.pushName || "Paciente",
                    telefono: chatId.split('@')[0],
                    mensaje: text,
                    respuesta_ia: respuesta
                });
            } catch (e) { console.log("Error en el flujo"); }
        }
    });
}

startBot();
