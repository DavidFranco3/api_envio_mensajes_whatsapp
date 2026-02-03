const fs = require('fs');
const path = require('path');

class MantenimientoWhatsApp {
  constructor() {
    this.logFile = 'logs/envios.json';
    this.statsFile = 'logs/estadisticas.json';
    this.initLogs();
  }

  initLogs() {
    if (!fs.existsSync('logs')) {
      fs.mkdirSync('logs');
    }
  }

  registrarEnvio(cliente, resultado) {
    const logEntry = {
      fecha: new Date().toISOString(),
      cliente: cliente.nombre,
      telefono: cliente.telefono,
      saldo: cliente.saldo,
      exito: resultado.success,
      mensajeId: resultado.mensajeId,
      error: resultado.error
    };

    fs.appendFileSync(this.logFile, JSON.stringify(logEntry) + '\n');
    console.log(`📝 Log registrado: ${cliente.nombre}`);
  }

  generarReporteDiario() {
    try {
      if (!fs.existsSync(this.logFile)) {
        return { total: 0, exitosos: 0 };
      }

      const hoy = new Date().toDateString();
      const logs = fs.readFileSync(this.logFile, 'utf8')
        .split('\n')
        .filter(line => line)
        .map(line => JSON.parse(line));

      const logsHoy = logs.filter(log => 
        new Date(log.fecha).toDateString() === hoy
      );

      return {
        fecha: hoy,
        total: logsHoy.length,
        exitosos: logsHoy.filter(log => log.exito).length,
        fallidos: logsHoy.filter(log => !log.exito).length,
        clientes: logsHoy.map(log => log.cliente)
      };

    } catch (error) {
      console.error('Error generando reporte:', error);
      return { error: error.message };
    }
  }

  limpiarSesionesViejas() {
    const sessionDir = './whatsapp_sessions';
    if (fs.existsSync(sessionDir)) {
      const unaSemanaAtras = Date.now() - (7 * 24 * 60 * 60 * 1000);
      
      fs.readdirSync(sessionDir).forEach(file => {
        const filePath = path.join(sessionDir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.mtimeMs < unaSemanaAtras && file !== '.gitkeep') {
          fs.unlinkSync(filePath);
          console.log(`🗑️  Eliminado: ${file}`);
        }
      });
    }
  }
}

module.exports = new MantenimientoWhatsApp();