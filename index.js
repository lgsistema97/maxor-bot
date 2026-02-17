const { default: makeWASocket, useMultiFileAuthState, delay, DisconnectReason, Browsers } = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require('express');

const app = express();
const PORT = process.env.PORT || 8080;
app.get('/', (req, res) => res.send('Maxor Bot: Esperando Vinculación 🦷'));
app.listen(PORT, '0.0.0.0');

// CONFIGURACIÓN - PON TU NÚMERO AQUÍ
const MI_NUMERO = "584243835271"; // Tu número con código de país, sin el +

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesion_vincular');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" }),
        browser: Browsers.macOS('Desktop'), // Identidad de escritorio para saltar el 405
        syncFullHistory: false
    });

    // --- PROCESO DE PAIRING CODE (ESTO REEMPLAZA AL QR) ---
    if (!sock.authState.creds.registered) {
        console.log(`\n\n🔗 GENERANDO CÓDIGO PARA: ${MI_NUMERO}`);
        await delay(5000); // Esperamos a que la conexión sea estable
        try {
            const code = await sock.requestPairingCode(MI_NUMERO);
            console.log("#################################################");
            console.log(`🔥 TU CÓDIGO DE VINCULACIÓN ES: ${code}`);
            console.log("#################################################\n");
            console.log("Instrucciones:");
            console.log("1. Abre WhatsApp en tu celular.");
            console.log("2. Ve a Dispositivos vinculados > Vincular un dispositivo.");
            console.log("3. Selecciona 'Vincular con el número de teléfono'.");
            console.log("4. Escribe el código de arriba.\n");
        } catch (e) {
            console.log("❌ No se pudo generar el código, reintentando...");
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') console.log('✅ ¡MAXOR CONECTADO EXITOSAMENTE!');
        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log(`⚠️ Conexión cerrada (${code}). Reintentando...`);
            if (code !== DisconnectReason.loggedOut) setTimeout(() => startBot(), 10000);
        }
    });
}

startBot();
