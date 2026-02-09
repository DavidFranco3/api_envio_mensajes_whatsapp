const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');
const filesToCopy = [
    'server.js',
    'package.json',
    'package-lock.json',
    'config.json',
    'mantenimiento.js',
    'reset-whatsapp.bat'
];

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir);
}

filesToCopy.forEach(file => {
    const src = path.join(__dirname, file);
    const dest = path.join(distDir, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`Copied: ${file}`);
    } else {
        console.log(`Skipped (not found): ${file}`);
    }
});

const readmeContent = `
# Instrucciones de Despliegue (WhatsApp API)

1. Copia todos los archivos de esta carpeta a tu servidor.
2. Abre una terminal en la carpeta.
3. Ejecuta el siguiente comando para instalar las dependencias:
   npm install --production

4. Inicia el servidor:
   npm start

   O si usas PM2 (recomendado para producción):
   pm2 start server.js --name "whatsapp-api"

NOTA: 
- El servidor intentará descargar la versión correcta de WhatsApp Web automáticamente.
- Asegúrate de tener Chrome/Chromium instalado si estás en Linux, o Puppeteer descargará una versión compatible.
`;

fs.writeFileSync(path.join(distDir, 'LEEME.txt'), readmeContent);
console.log('Build preparation complete in /dist');
