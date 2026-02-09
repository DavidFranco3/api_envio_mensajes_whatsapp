@echo off
echo 🔄 Reiniciando WhatsApp API...

taskkill /F /IM node.exe 2>nul
taskkill /F /IM chrome.exe 2>nul

rmdir /S /Q whatsapp_sessions\.wwebjs_cache 2>nul
rmdir /S /Q whatsapp_sessions\.wwebjs_auth 2>nul

echo 📦 Reinstalando dependencias...
rmdir /S /Q node_modules 2>nul
del package-lock.json 2>nul
npm install

echo 🚀 Iniciando servidor...
npm start