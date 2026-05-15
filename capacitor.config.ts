import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.aetheryon.bitacoranoir',
  appName: 'Bitácora Noir',
  webDir: 'frontend',
  server: {
    url: 'https://aetheryon-bitacora.onrender.com',
    cleartext: false,
    androidScheme: 'https'
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: true
  }
};

export default config;
