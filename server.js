const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.PORT || 3001;

// Middleware simple
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ==================== CONFIGURACIÓN WHATSAPP ====================
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'recordatorios-pagos',
        dataPath: './whatsapp_sessions'
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ]
    }
});

// ==================== ESTADO SIMPLE ====================
const state = {
    isConnected: false,
    qrCode: null,
    lastConnection: null,
    stats: {
        totalSent: 0,
        todaySent: 0,
        lastReset: new Date().toDateString()
    }
};

// ==================== SISTEMA DE HISTORIAL ====================
// Configurar directorio de logs
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

const historyFile = path.join(logsDir, 'notifications.json');

// Inicializar archivo de historial si no existe
if (!fs.existsSync(historyFile)) {
    fs.writeFileSync(historyFile, JSON.stringify([]));
}

// Función para registrar notificación
const logNotification = (notification) => {
    try {
        const history = JSON.parse(fs.readFileSync(historyFile, 'utf8') || '[]');
        history.unshift({
            id: Date.now(),
            timestamp: new Date().toISOString(),
            ...notification
        });

        // Mantener máximo 1000 registros
        const trimmedHistory = history.slice(0, 1000);
        fs.writeFileSync(historyFile, JSON.stringify(trimmedHistory, null, 2));

        console.log(`📝 Notificación registrada en historial: ${notification.cliente}`);
    } catch (error) {
        console.error('Error registrando notificación:', error);
    }
};

// ==================== PATCH PARA ERROR markedUnread ====================
const applyWhatsAppPatch = () => {
    console.log('🔧 Aplicando patch para error markedUnread...');

    const originalSendMessage = client.sendMessage.bind(client);

    client.sendMessage = async function (chatId, content, options = {}) {
        console.log(`📤 Patch: Enviando mensaje a ${chatId}`);

        try {
            const result = await originalSendMessage(chatId, content, {
                ...options,
                linkPreview: false,
                sendSeen: false,
                method: 'text'
            });

            console.log('✅ Patch: Mensaje enviado exitosamente');
            return result;

        } catch (firstError) {
            console.log(`⚠️  Intento 1 falló: ${firstError.message}`);

            const errorMessage = firstError.message.toLowerCase();
            const shouldTryAlternative = 
                errorMessage.includes('markedunread') ||
                errorMessage.includes('undefined') ||
                errorMessage.includes('findchat') ||
                errorMessage.includes('not found') ||
                errorMessage.includes('execution context was destroyed');

            if (shouldTryAlternative) {
                console.log('🔄 Intento 2: Método alternativo (Puppeteer Direct)');

                try {
                    const page = this.pupPage;
                    if (!page) throw new Error('No hay página disponible');

                    // Extraer solo números para la URL
                    const phoneOnly = chatId.toString().split('@')[0].replace(/\D/g, '');
                    console.log(`🔗 Navegando a chat de: ${phoneOnly}`);
                    
                    const encodedMsg = encodeURIComponent(content);
                    const url = `https://web.whatsapp.com/send?phone=${phoneOnly}&text=${encodedMsg}`;

                    await page.goto(url, {
                        waitUntil: 'networkidle0',
                        timeout: 35000
                    });

                    // Esperar a que cargue el cuadro de texto
                    await page.waitForSelector('div[contenteditable="true"]', {
                        timeout: 20000
                    });

                    // Un pequeño delay extra para estabilidad
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    
                    // Presionar Enter
                    await page.keyboard.press('Enter');
                    
                    // Esperar a que se envíe
                    await new Promise(resolve => setTimeout(resolve, 5000));

                    console.log('✅ Patch: Mensaje enviado (método alternativo)');

                    return {
                        id: { _serialized: `${chatId}_${Date.now()}` },
                        body: content,
                        timestamp: Date.now(),
                        fromMe: true,
                        to: chatId
                    };

                } catch (patchError) {
                    console.error(`❌ Patch falló: ${patchError.message}`);
                    throw new Error(`No se pudo enviar mensaje (ni con patch): ${firstError.message}`);
                }
            }
            throw firstError;
        }
    };

    console.log('✅ Patch aplicado exitosamente');
};

// ==================== EVENTOS ====================
client.on('qr', (qr) => {
    console.log('\n' + '🔢'.repeat(30));
    console.log('NUEVO CÓDIGO QR GENERADO:');
    console.log('🔢'.repeat(30));
    qrcode.generate(qr, { small: true });
    state.qrCode = qr;
    state.isConnected = false;
});

client.on('ready', () => {
    console.log('\n' + '✅'.repeat(30));
    console.log('¡WHATSAPP CONECTADO Y LISTO!');
    console.log('✅'.repeat(30));

    state.isConnected = true;
    state.qrCode = null;
    state.lastConnection = new Date();

    setTimeout(() => {
        applyWhatsAppPatch();
    }, 3000);
});

client.on('disconnected', (reason) => {
    console.log(`\n⚠️  WhatsApp desconectado: ${reason}`);
    state.isConnected = false;

    setTimeout(() => {
        console.log('🔄 Reconectando...');
        client.initialize();
    }, 5000);
});

// Inicializar
console.log('\n🚀 Inicializando WhatsApp Web...');
client.initialize();

// ==================== FUNCIONES ESENCIALES ====================
const formatMexicanPhone = (phone) => {
    try {
        let clean = phone.toString().replace(/\D/g, '');

        if (clean.length === 10) {
            return `521${clean}@c.us`;
        } else if (clean.length === 12 && clean.startsWith('52')) {
            return `521${clean.substring(2)}@c.us`;
        } else if (clean.length === 13 && clean.startsWith('521')) {
            return `${clean}@c.us`;
        } else if (clean.startsWith('1')) {
            return `${clean}@c.us`;
        } else {
            return `${clean}@c.us`;
        }

    } catch (error) {
        console.error(`❌ Error formateando teléfono: ${error.message}`);
        throw error;
    }
};

const messageTemplates = {
    primerRecordatorio: (cliente, monto, vencimiento) =>
        `Hola ${cliente.nombre}, este es un recordatorio amable:\n\n` +
        `💵 Tienes un saldo pendiente de *$${monto}*\n` +
        `📅 Vence el ${vencimiento}\n\n` +
        `¿Necesitas ayuda con el pago?`,

    segundoRecordatorio: (cliente, monto, diasVencido) =>
        `Hola ${cliente.nombre},\n\n` +
        `💵 Tu saldo de *$${monto}* está vencido hace ${diasVencido} día${diasVencido > 1 ? 's' : ''}\n\n` +
        `Por favor regularízalo pronto.`,

    ultimoRecordatorio: (cliente, monto) =>
        `Hola ${cliente.nombre}, *URGENTE*\n\n` +
        `💵 Saldo vencido: *$${monto}*\n\n` +
        `Es importante que contactes con nosotros para evitar cargos adicionales.\n\n` +
        `Gracias.`,

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

// ==================== ENDPOINTS DE HISTORIAL ====================

// Obtener historial de notificaciones
app.get('/notifications/history', (req, res) => {
    try {
        const { limit = 50, page = 1, tipo, fechaDesde, fechaHasta } = req.query;
        const history = JSON.parse(fs.readFileSync(historyFile, 'utf8') || '[]');

        let filtered = [...history];

        // Filtrar por tipo
        if (tipo && tipo !== 'todos') {
            filtered = filtered.filter(n => n.tipo === tipo);
        }

        // Filtrar por fecha
        if (fechaDesde) {
            const desde = new Date(fechaDesde);
            filtered = filtered.filter(n => new Date(n.timestamp) >= desde);
        }

        if (fechaHasta) {
            const hasta = new Date(fechaHasta);
            filtered = filtered.filter(n => new Date(n.timestamp) <= hasta);
        }

        // Paginación
        const start = (page - 1) * limit;
        const end = start + parseInt(limit);
        const paginated = filtered.slice(start, end);

        res.json({
            success: true,
            total: filtered.length,
            page: parseInt(page),
            totalPages: Math.ceil(filtered.length / limit),
            limit: parseInt(limit),
            notifications: paginated
        });

    } catch (error) {
        console.error('Error obteniendo historial:', error);
        res.status(500).json({
            success: false,
            error: 'Error obteniendo historial'
        });
    }
});

// Estadísticas de notificaciones
app.get('/notifications/stats', (req, res) => {
    try {
        const history = JSON.parse(fs.readFileSync(historyFile, 'utf8') || '[]');

        // Últimos 30 días
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const last30Days = history.filter(n =>
            new Date(n.timestamp) >= thirtyDaysAgo
        );

        // Estadísticas por tipo
        const statsByType = {
            primerRecordatorio: 0,
            segundoRecordatorio: 0,
            ultimoRecordatorio: 0,
            personalizado: 0
        };

        last30Days.forEach(n => {
            if (statsByType[n.tipo] !== undefined) {
                statsByType[n.tipo]++;
            }
        });

        // Estadísticas por día (últimos 7 días)
        const dailyStats = {};
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            dailyStats[dateStr] = 0;
        }

        last30Days.forEach(n => {
            const date = new Date(n.timestamp).toISOString().split('T')[0];
            if (dailyStats[date] !== undefined) {
                dailyStats[date]++;
            }
        });

        // Tasa de éxito
        const total = last30Days.length;
        const success = last30Days.filter(n => n.exito).length;
        const successRate = total > 0 ? (success / total * 100).toFixed(1) : 0;

        res.json({
            success: true,
            stats: {
                total30Days: total,
                successRate: `${successRate}%`,
                byType: statsByType,
                daily: dailyStats,
                topClients: Object.entries(
                    last30Days.reduce((acc, n) => {
                        acc[n.cliente] = (acc[n.cliente] || 0) + 1;
                        return acc;
                    }, {})
                ).slice(0, 5)
            }
        });

    } catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Exportar historial
app.get('/notifications/export', (req, res) => {
    try {
        const history = JSON.parse(fs.readFileSync(historyFile, 'utf8') || '[]');
        const { format = 'json' } = req.query;

        if (format === 'csv') {
            // Convertir a CSV
            const headers = ['Fecha', 'Cliente', 'Teléfono', 'Tipo', 'Saldo', 'Éxito', 'Método', 'Tiempo (ms)'];
            const csvRows = history.map(n => [
                n.timestamp,
                n.cliente,
                n.telefono,
                n.tipo,
                n.saldo,
                n.exito ? 'Sí' : 'No',
                n.metodo,
                n.tiempo
            ]);

            const csvContent = [
                headers.join(','),
                ...csvRows.map(row => row.join(','))
            ].join('\n');

            res.header('Content-Type', 'text/csv');
            res.header('Content-Disposition', 'attachment; filename=notificaciones.csv');
            res.send(csvContent);

        } else {
            // JSON por defecto
            res.header('Content-Type', 'application/json');
            res.header('Content-Disposition', 'attachment; filename=notificaciones.json');
            res.send(JSON.stringify(history, null, 2));
        }

    } catch (error) {
        console.error('Error exportando historial:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Limpiar historial
app.delete('/notifications/clear', (req, res) => {
    try {
        fs.writeFileSync(historyFile, JSON.stringify([]));
        res.json({
            success: true,
            message: 'Historial limpiado exitosamente'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== ENDPOINTS DE ENVÍO ====================

// Enviar recordatorio INDIVIDUAL
app.post('/send-reminder', async (req, res) => {
    const { cliente, tipo = 'primerRecordatorio', mensajePersonalizado } = req.body;

    console.log('\n' + '='.repeat(60));
    console.log('📨 SOLICITUD DE RECORDATORIO');
    console.log('='.repeat(60));

    if (!cliente || !cliente.telefono || !cliente.nombre || cliente.saldo === undefined) {
        console.log('❌ Datos incompletos');
        return res.status(400).json({
            success: false,
            error: 'Datos incompletos',
            requeridos: ['cliente.telefono', 'cliente.nombre', 'cliente.saldo']
        });
    }

    if (!state.isConnected) {
        console.log('❌ WhatsApp no conectado');
        return res.status(503).json({
            success: false,
            error: 'WhatsApp no conectado',
            suggestion: 'Escanea el QR en /qrcode'
        });
    }

    const startTime = Date.now();

    try {
        // Formatear teléfono
        const chatId = formatMexicanPhone(cliente.telefono);
        console.log(`👤 Cliente: ${cliente.nombre}`);
        console.log(`📱 Teléfono: ${cliente.telefono} → ${chatId}`);
        console.log(`💰 Saldo: $${Math.abs(cliente.saldo).toFixed(2)}`);
        console.log(`📝 Tipo: ${tipo}`);

        // Crear mensaje
        let mensaje = '';

        if (tipo === 'personalizado' && mensajePersonalizado) {
            mensaje = `Hola ${cliente.nombre},\n\n${mensajePersonalizado}`;
        } else {
            switch (tipo) {
                case 'segundoRecordatorio':
                    mensaje = messageTemplates.segundoRecordatorio(
                        cliente,
                        Math.abs(cliente.saldo).toFixed(2),
                        cliente.diasVencido || 3
                    );
                    break;
                case 'ultimoRecordatorio':
                    mensaje = messageTemplates.ultimoRecordatorio(
                        cliente,
                        Math.abs(cliente.saldo).toFixed(2)
                    );
                    break;
                case 'personalizado':
                    mensaje = messageTemplates.personalizado(cliente, mensajePersonalizado || '');
                    break;
                default: // primerRecordatorio
                    mensaje = messageTemplates.primerRecordatorio(
                        cliente,
                        Math.abs(cliente.saldo).toFixed(2),
                        cliente.vencimiento || 'próximos días'
                    );
            }
        }

        console.log(`💬 Mensaje (${mensaje.length} chars):\n"${mensaje.substring(0, 100)}${mensaje.length > 100 ? '...' : ''}"`);

        // Verificar número
        console.log(`🔍 Verificando número...`);
        let tieneWhatsApp = false;
        let verificacionError = null;

        try {
            tieneWhatsApp = await client.isRegisteredUser(chatId);
            console.log(`✅ Verificación: ${tieneWhatsApp ? 'TIENE WhatsApp' : 'NO tiene WhatsApp'}`);
        } catch (verifyError) {
            verificacionError = verifyError.message;
            console.log(`⚠️  Error en verificación: ${verificacionError}`);
            tieneWhatsApp = true;
        }

        if (!tieneWhatsApp && !verificacionError) {
            console.log(`❌ Número sin WhatsApp`);
            return res.status(404).json({
                success: false,
                error: 'Número sin WhatsApp',
                cliente: cliente.nombre,
                telefono: cliente.telefono,
                suggestion: 'Verifica el número o usa otro medio de contacto'
            });
        }

        // Enviar mensaje
        console.log(`🚀 Iniciando envío...`);

        let resultadoEnvio;
        let metodoUsado = 'normal';

        try {
            resultadoEnvio = await client.sendMessage(chatId, mensaje);
            console.log(`✅ Mensaje enviado exitosamente`);

        } catch (sendError) {
            console.error(`❌ Error enviando: ${sendError.message}`);
            throw sendError;
        }

        // Actualizar estadísticas
        state.stats.totalSent++;
        state.stats.todaySent++;

        // Reset diario si cambió el día
        const hoy = new Date().toDateString();
        if (state.stats.lastReset !== hoy) {
            state.stats.todaySent = 1;
            state.stats.lastReset = hoy;
        }

        const elapsedTime = Date.now() - startTime;

        // Registrar en historial
        const notificationRecord = {
            cliente: cliente.nombre,
            telefono: cliente.telefono,
            saldo: cliente.saldo,
            tipo: tipo,
            mensaje: mensaje.substring(0, 200),
            exito: true,
            metodo: metodoUsado,
            tiempo: elapsedTime
        };

        logNotification(notificationRecord);

        console.log(`📊 Estadísticas actualizadas:`);
        console.log(`   Total mensual: ${state.stats.totalSent}/1500`);
        console.log(`   Hoy: ${state.stats.todaySent}`);
        console.log(`   Tiempo: ${elapsedTime}ms`);
        console.log('='.repeat(60));

        // Respuesta exitosa
        res.json({
            success: true,
            cliente: cliente.nombre,
            telefono: cliente.telefono,
            saldo: cliente.saldo,
            mensajeId: resultadoEnvio?.id?._serialized || `${chatId}_${Date.now()}`,
            timestamp: new Date().toISOString(),
            deliveryTime: elapsedTime,
            method: metodoUsado,
            stats: {
                total: state.stats.totalSent,
                hoy: state.stats.todaySent,
                restanteMes: 1500 - state.stats.totalSent
            }
        });

    } catch (error) {
        const elapsedTime = Date.now() - startTime;

        console.error(`\n${'❌'.repeat(20)}`);
        console.error(`ERROR EN ENVÍO:`);
        console.error(`Cliente: ${cliente?.nombre || 'Desconocido'}`);
        console.error(`Error: ${error.message}`);
        console.error(`Tiempo: ${elapsedTime}ms`);
        console.error(`${'❌'.repeat(20)}\n`);

        // Registrar error en historial
        if (cliente) {
            const errorRecord = {
                cliente: cliente.nombre,
                telefono: cliente.telefono,
                saldo: cliente.saldo,
                tipo: tipo,
                exito: false,
                error: error.message,
                tiempo: elapsedTime
            };
            logNotification(errorRecord);
        }

        // Determinar tipo de error
        let statusCode = 500;
        let errorType = 'internal_error';
        let userMessage = 'Error interno al enviar mensaje';

        if (error.message.includes('markedUnread') ||
            error.message.includes('undefined')) {
            errorType = 'whatsapp_api_error';
            userMessage = 'Error temporal de WhatsApp Web';
            statusCode = 503;
        } else if (error.message.includes('not registered') ||
            error.message.includes('sin WhatsApp')) {
            errorType = 'not_registered';
            userMessage = 'El número no está registrado en WhatsApp';
            statusCode = 404;
        } else if (error.message.includes('timeout')) {
            errorType = 'timeout';
            userMessage = 'Timeout al enviar mensaje';
            statusCode = 504;
        }

        res.status(statusCode).json({
            success: false,
            cliente: cliente?.nombre,
            error: userMessage,
            errorType: errorType,
            details: error.message,
            elapsedTime: elapsedTime,
            timestamp: new Date().toISOString(),
            suggestion: errorType === 'whatsapp_api_error' ?
                'Reintenta en 1 minuto' :
                'Verifica el número de teléfono'
        });
    }
});

// Enviar recordatorios MASIVOS
app.post('/send-batch-reminders', async (req, res) => {
    const { clientes, tipo = 'primerRecordatorio', delay = 2000 } = req.body;

    console.log('\n' + '📦'.repeat(20));
    console.log('ENVÍO MASIVO DE RECORDATORIOS');
    console.log('📦'.repeat(20));

    if (!Array.isArray(clientes) || clientes.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'Lista de clientes vacía'
        });
    }

    if (!state.isConnected) {
        return res.status(503).json({
            success: false,
            error: 'WhatsApp no conectado'
        });
    }

    const limiteLote = Math.min(clientes.length, 30);
    const resultados = [];
    let exitosos = 0;
    let fallidos = 0;

    console.log(`📊 Procesando lote de ${limiteLote} clientes...`);

    for (let i = 0; i < limiteLote; i++) {
        const cliente = clientes[i];

        try {
            if (i > 0) {
                console.log(`⏳ Esperando ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }

            console.log(`\n[${i + 1}/${limiteLote}] ${cliente.nombre}`);

            const chatId = formatMexicanPhone(cliente.telefono);

            let mensaje = '';
            if (tipo === 'segundoRecordatorio') {
                mensaje = messageTemplates.segundoRecordatorio(
                    cliente,
                    Math.abs(cliente.saldo).toFixed(2),
                    cliente.diasVencido || 5
                );
            } else if (tipo === 'ultimoRecordatorio') {
                mensaje = messageTemplates.ultimoRecordatorio(
                    cliente,
                    Math.abs(cliente.saldo).toFixed(2)
                );
            } else {
                mensaje = messageTemplates.primerRecordatorio(
                    cliente,
                    Math.abs(cliente.saldo).toFixed(2),
                    cliente.vencimiento || 'próximos días'
                );
            }

            const resultado = await client.sendMessage(chatId, mensaje);

            state.stats.totalSent++;
            state.stats.todaySent++;

            // Registrar en historial
            logNotification({
                cliente: cliente.nombre,
                telefono: cliente.telefono,
                saldo: cliente.saldo,
                tipo: tipo,
                mensaje: mensaje.substring(0, 200),
                exito: true,
                metodo: 'batch',
                tiempo: 0
            });

            resultados.push({
                index: i,
                cliente: cliente.nombre,
                telefono: cliente.telefono,
                success: true,
                mensajeId: resultado.id?._serialized || `${chatId}_${Date.now()}`
            });

            exitosos++;
            console.log(`✅ Enviado`);

        } catch (error) {
            // Registrar error en historial
            logNotification({
                cliente: cliente.nombre,
                telefono: cliente.telefono,
                saldo: cliente.saldo,
                tipo: tipo,
                exito: false,
                error: error.message,
                tiempo: 0
            });

            resultados.push({
                index: i,
                cliente: cliente.nombre,
                telefono: cliente.telefono,
                success: false,
                error: error.message
            });
            fallidos++;
            console.log(`❌ Error: ${error.message}`);
        }
    }

    // Reset diario
    const hoy = new Date().toDateString();
    if (state.stats.lastReset !== hoy) {
        state.stats.todaySent = exitosos;
        state.stats.lastReset = hoy;
    }

    console.log(`\n${'📊'.repeat(20)}`);
    console.log(`RESULTADO FINAL:`);
    console.log(`✅ Exitosos: ${exitosos}`);
    console.log(`❌ Fallidos: ${fallidos}`);
    console.log(`${'📊'.repeat(20)}\n`);

    res.json({
        success: true,
        total: limiteLote,
        exitosos,
        fallidos,
        resultados,
        stats: {
            totalMes: state.stats.totalSent,
            hoy: state.stats.todaySent,
            restanteMes: 1500 - state.stats.totalSent
        }
    });
});

// ==================== ENDPOINTS ADICIONALES ====================

app.post('/test-number', async (req, res) => {
    const { telefono } = req.body;

    if (!telefono) {
        return res.status(400).json({
            success: false,
            error: 'Teléfono requerido'
        });
    }

    try {
        const chatId = formatMexicanPhone(telefono);
        const tieneWhatsApp = await client.isRegisteredUser(chatId);

        res.json({
            success: true,
            telefono: telefono,
            formateado: chatId,
            tieneWhatsApp,
            recomendacion: tieneWhatsApp ?
                '✅ Listo para recordatorios' :
                '❌ No tiene WhatsApp, usar SMS o llamada'
        });

    } catch (error) {
        console.error(`Error verificando ${telefono}: ${error.message}`);

        res.status(400).json({
            success: false,
            telefono: telefono,
            error: error.message,
            formatosAceptados: [
                '10 dígitos mexicanos: 5512345678',
                'Con lada: 5551234567',
                'Con código: 525512345678',
                'Con +52: +525512345678'
            ],
            sugerencia: 'Para México, usa 10 dígitos (ej: 5512345678)'
        });
    }
});

app.get('/dashboard', (req, res) => {
    const usado = state.stats.totalSent;
    const restante = 1500 - usado;
    const porcentaje = (usado / 1500 * 100).toFixed(1);

    res.json({
        mensual: {
            limite: 1500,
            usado: usado,
            restante: restante,
            porcentaje: porcentaje + '%'
        },
        diario: {
            hoy: state.stats.todaySent,
            promedioNecesario: restante > 0 ? (restante / 30).toFixed(1) + '/día' : 'Límite alcanzado'
        },
        estado: {
            connected: state.isConnected,
            qrAvailable: !!state.qrCode,
            lastConnection: state.lastConnection
        },
        recomendaciones: [
            'Máximo 30 mensajes por lote',
            'Delay de 2-3 segundos entre mensajes',
            'Verificar números antes de agregar',
            'No superar 50 mensajes por hora'
        ],
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    const memoryUsage = process.memoryUsage();

    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: {
            rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`,
            heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
            heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`
        },
        whatsapp: {
            connected: state.isConnected,
            lastConnection: state.lastConnection
        }
    });
});

// Ruta raíz
app.get('/', (req, res) => {
    res.json({
        service: 'WhatsApp Recordatorios de Pagos',
        version: '2.0.0',
        endpoints: {
            status: 'GET /status',
            qrcode: 'GET /qrcode',
            dashboard: 'GET /dashboard',
            health: 'GET /health',
            sendReminder: 'POST /send-reminder',
            sendBatch: 'POST /send-batch-reminders',
            testNumber: 'POST /test-number',
            notificationsHistory: 'GET /notifications/history',
            notificationsStats: 'GET /notifications/stats',
            notificationsExport: 'GET /notifications/export',
            notificationsClear: 'DELETE /notifications/clear'
        },
        monthlyLimit: 1500,
        used: state.stats.totalSent,
        remaining: 1500 - state.stats.totalSent,
        connected: state.isConnected
    });
});

// Manejo de rutas no encontradas
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Ruta no encontrada',
        availableRoutes: [
            'GET /',
            'GET /status',
            'GET /qrcode',
            'GET /dashboard',
            'GET /health',
            'GET /notifications/history',
            'GET /notifications/stats',
            'GET /notifications/export',
            'POST /send-reminder',
            'POST /send-batch-reminders',
            'POST /test-number',
            'DELETE /notifications/clear'
        ]
    });
});

// Iniciar servidor
app.listen(port, () => {
    console.log(`
    💰 SERVIDOR DE RECORDATORIOS DE PAGOS v2.0
    ============================================
    Puerto: ${port}
    Límite mensual: 1500 mensajes
    Historial: ✅ Habilitado
    Patch: ✅ markedUnread fix
    
    📱 Endpoints:
    - GET  /status              → Estado WhatsApp
    - GET  /qrcode             → Obtener QR
    - GET  /dashboard          → Estadísticas
    - GET  /health             → Salud del servidor
    
    📋 Historial:
    - GET  /notifications/history → Historial de notificaciones
    - GET  /notifications/stats   → Estadísticas
    - GET  /notifications/export  → Exportar historial
    - DELETE /notifications/clear → Limpiar historial
    
    📤 Envío:
    - POST /send-reminder      → Recordatorio individual
    - POST /send-batch-reminders → Lote controlado
    - POST /test-number        → Verificar número
    
    ⚠️  Recomendaciones:
    • Usa /test-number antes de agregar clientes
    • Monitorea /dashboard regularmente
    • Máximo 30 mensajes por lote
    • Delay de 2-3 segundos entre mensajes
    ============================================
    `);
});

// Manejo de señales
process.on('SIGINT', () => {
    console.log('\n\n🔻 Recibida señal SIGINT, cerrando...');

    if (state.isConnected) {
        console.log('🔌 Desconectando WhatsApp...');
        client.destroy();
    }

    console.log('👋 Servidor cerrado');
    process.exit(0);
});

module.exports = { app, client, state };