// Frontend ko pata chale ke ye desktop app hai (landing page skip)
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('typos', { isDesktop: true, platform: process.platform, version: '1.0.0' });
