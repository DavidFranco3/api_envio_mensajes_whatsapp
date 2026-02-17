const express = require('express');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

const app = express();
const port = process.env.PORT || 3001;

// Middleware simple
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ==================== CONFIGURACIÓN WHATSAPP ====================
const state = {
    sock: null,
    isConnected: false,
    qrCode: null,
    lastConnection: null,
    stats: {
        totalSent: 0,
        todaySent: 0,
        lastReset: new Date().toDateString()
    }
};

const logger = pino({ level: 'silent' });
const sessionsDir = process.env.VERCEL ? '/tmp/whatsapp_sessions' : './whatsapp_sessions';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function connectToWhatsApp() {
    if (state.sock) {
        state.sock.ev.removeAllListeners('connection.update');
        state.sock.ev.removeAllListeners('creds.update');
        try {
            state.sock.ws.close();
        } catch (e) { }
        state.sock = null;
    }

    const { state: authState, saveCreds } = await useMultiFileAuthState(sessionsDir);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`📡 Usando Versión de WhatsApp v${version.join('.')}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: {
            creds: authState.creds,
            keys: makeCacheableSignalKeyStore(authState.keys, logger),
        },
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        markOnlineOnConnect: true,
    });

    state.sock = sock;

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n' + '🔢'.repeat(30));
            console.log('NUEVO CÓDIGO QR GENERADO:');
            console.log('🔢'.repeat(30));
            qrcode.generate(qr, { small: true });
            state.qrCode = qr;
            state.isConnected = false;
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect.error)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`⚠️ Conexión cerrada. Código: ${statusCode}. Reconectando: ${shouldReconnect}`);

            state.isConnected = false;
            if (shouldReconnect) {
                // Pequeño delay para evitar loops inmediatos
                await delay(5000);
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('\n' + '✅'.repeat(30));
            console.log('¡WHATSAPP CONECTADO Y LISTO!');
            console.log('✅'.repeat(30));
            state.isConnected = true;
            state.qrCode = null;
            state.lastConnection = new Date();
        }
    });

    sock.ev.on('creds.update', saveCreds);

    return sock;
}

// ==================== SISTEMA DE HISTORIAL ====================
const logsDir = process.env.VERCEL ? path.join('/tmp', 'logs') : path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

const historyFile = path.join(logsDir, 'notifications.json');
if (!fs.existsSync(historyFile)) {
    fs.writeFileSync(historyFile, JSON.stringify([]));
}

const logNotification = (notification) => {
    try {
        const history = JSON.parse(fs.readFileSync(historyFile, 'utf8') || '[]');
        history.unshift({
            id: Date.now(),
            timestamp: new Date().toISOString(),
            ...notification
        });

        const trimmedHistory = history.slice(0, 1000);
        fs.writeFileSync(historyFile, JSON.stringify(trimmedHistory, null, 2));
        console.log(`📝 Notificación registrada en historial: ${notification.cliente}`);
    } catch (error) {
        console.error('Error registrando notificación:', error);
    }
};

// ==================== FUNCIONES ESENCIALES ====================
const formatMexicanPhone = (phone) => {
    try {
        let clean = phone.toString().replace(/\D/g, '');
        if (clean.length === 10) {
            return `521${clean}@s.whatsapp.net`;
        } else if (clean.length === 12 && clean.startsWith('52')) {
            return `521${clean.substring(2)}@s.whatsapp.net`;
        } else if (clean.length === 13 && clean.startsWith('521')) {
            return `${clean}@s.whatsapp.net`;
        } else {
            return `${clean}@s.whatsapp.net`;
        }
    } catch (error) {
        console.error(`❌ Error formateando teléfono: ${error.message}`);
        throw error;
    }
};

const messageTemplates = {
    primerRecordatorio: (cliente, monto, vencimiento) =>
        `👋 Hola *${cliente.nombre}*,\n\n` +
        `📝 Le recordamos amablemente su próximo pago del servicio de internet.\n\n` +
        `💰 *Monto a pagar:* $${monto}\n` +
        `📅 *Fecha límite:* ${vencimiento}\n\n` +
        `✨ Agradecemos su puntualidad. ¡Que tenga un excelente día!`,

    segundoRecordatorio: (cliente, monto, diasVencido) =>
        `👋 Hola *${cliente.nombre}*,\n\n` +
        `⚠️ *RECORDATORIO DE PAGO*\n\n` +
        `Notamos que su pago de *$${monto}* tiene un retraso de *${diasVencido} día${diasVencido > 1 ? 's' : ''}*.\n\n` +
        `🙏 Le invitamos a realizarlo a la brevedad para seguir disfrutando de su servicio sin interrupciones.\n\n` +
        `¿Ya realizó el pago? Por favor envíenos el comprobante. 📸`,

    ultimoRecordatorio: (cliente, monto) =>
        `🛑 *AVISO URGENTE*\n\n` +
        `Estimado/a *${cliente.nombre}*,\n\n` +
        `Su saldo vencido es de: *$${monto}*\n\n` +
        `⚠️ Su servicio está próximo a ser suspendido. Por favor regularice su situación hoy mismo.\n\n` +
        `Si ya pagó, haga caso omiso de este mensaje.`,

    recordatorio: (cliente, monto, vencimiento) => messageTemplates.primerRecordatorio(cliente, monto, vencimiento),
    aviso: (cliente, monto) =>
        `👋 Hola *${cliente.nombre}*,\n\n` +
        `⚠️ *AVISO DE SALDO PENDIENTE*\n\n` +
        `Le informamos que presenta un saldo vencido de *$${monto}*.\n\n` +
        `🔌 Para evitar la suspensión del servicio, le sugerimos realizar su pago lo antes posible.\n\n` +
        `Gracias por su atención.`,

    suspension: (cliente) =>
        `Hola ${cliente.nombre},\n\n` +
        `⚠️ *AVISO DE SUSPENSIÓN*\n\n` +
        `Le informamos que su servicio ha sido *suspendido* por falta de pago.\n` +
        `Por favor realice su pago para restablecer el servicio inmediatamente.`,

    reactivacion: (cliente) =>
        `Hola ${cliente.nombre},\n\n` +
        `✅ *SERVICIO REACTIVADO*\n\n` +
        `Su pago ha sido procesado exitosamente y su servicio ha sido restablecido.\n` +
        `¡Gracias por su preferencia!`,

    baja: (cliente) =>
        `Hola ${cliente.nombre},\n\n` +
        `ℹ️ *AVISO DE BAJA*\n\n` +
        `Le confirmamos que su contrato ha sido dado de baja correctamente.\n` +
        `Lamentamos verle partir y esperamos poder servirle nuevamente en el futuro.`,

    personalizado: (cliente, mensaje) =>
        `Hola ${cliente.nombre},\n\n${mensaje}`
};

// ==================== ENDPOINTS BÁSICOS ====================
app.get('/status', (req, res) => {
    res.json({
        connected: state.isConnected,
        qrAvailable: !!state.qrCode,
        lastConnection: state.lastConnection,
        stats: state.stats,
        monthlyLimit: 1500,
        remaining: 1500 - state.stats.totalSent,
        timestamp: new Date().toISOString()
    });
});

app.get('/qrcode', (req, res) => {
    if (state.qrCode) {
        res.json({
            qr: state.qrCode,
            available: true,
            message: 'Escanea este código con WhatsApp'
        });
    } else {
        res.json({
            available: false,
            connected: state.isConnected,
            message: state.isConnected ?
                '✅ WhatsApp conectado' :
                '⏳ Generando nuevo código QR...'
        });
    }
});

// ==================== ENDPOINTS DE ENVÍO ====================
app.post('/send-reminder', async (req, res) => {
    const { cliente, tipo = 'primerRecordatorio', mensajePersonalizado } = req.body;

    if (!cliente || !cliente.telefono || !cliente.nombre || cliente.saldo === undefined) {
        return res.status(400).json({
            success: false,
            error: 'Datos incompletos',
            requeridos: ['cliente.telefono', 'cliente.nombre', 'cliente.saldo']
        });
    }

    if (!state.isConnected) {
        return res.status(503).json({
            success: false,
            error: 'WhatsApp no conectado'
        });
    }

    const startTime = Date.now();
    try {
        const chatId = formatMexicanPhone(cliente.telefono);
        let mensaje = '';

        if (mensajePersonalizado && mensajePersonalizado.trim() !== '') {
            mensaje = mensajePersonalizado;
        } else {
            switch (tipo) {
                case 'segundoRecordatorio':
                    mensaje = messageTemplates.segundoRecordatorio(cliente, Math.abs(cliente.saldo).toFixed(2), cliente.diasVencido || 3);
                    break;
                case 'ultimoRecordatorio':
                    mensaje = messageTemplates.ultimoRecordatorio(cliente, Math.abs(cliente.saldo).toFixed(2));
                    break;
                case 'recordatorio':
                    mensaje = messageTemplates.recordatorio(cliente, Math.abs(cliente.saldo).toFixed(2), cliente.vencimiento || 'pronto');
                    break;
                case 'aviso':
                    mensaje = messageTemplates.aviso(cliente, Math.abs(cliente.saldo).toFixed(2));
                    break;
                case 'suspension':
                    mensaje = messageTemplates.suspension(cliente);
                    break;
                case 'reactivacion':
                    mensaje = messageTemplates.reactivacion(cliente);
                    break;
                case 'baja':
                    mensaje = messageTemplates.baja(cliente);
                    break;
                default:
                    mensaje = messageTemplates.primerRecordatorio(cliente, Math.abs(cliente.saldo).toFixed(2), cliente.vencimiento || 'próximos días');
            }
        }

        const sentMsg = await state.sock.sendMessage(chatId, { text: mensaje });

        state.stats.totalSent++;
        state.stats.todaySent++;

        const elapsedTime = Date.now() - startTime;
        logNotification({
            cliente: cliente.nombre,
            telefono: cliente.telefono,
            saldo: cliente.saldo,
            tipo: tipo,
            mensaje: mensaje.substring(0, 200),
            exito: true,
            metodo: 'baileys',
            tiempo: elapsedTime
        });

        res.json({
            success: true,
            cliente: cliente.nombre,
            mensajeId: sentMsg.key.id,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/', (req, res) => {
    res.send('WhatsApp Baileys Backend is running!');
});

if (require.main === module) {
    app.listen(port, () => {
        console.log(`🚀 SERVIDOR WHATSAPP (Baileys) v3.0 LISTO EN PUERTO ${port}`);
        connectToWhatsApp();
    });
}

module.exports = app;
