import pino from 'pino';

/** Logger internal Baileys dibungkam; log aplikasi ditangani Logger sendiri. */
export const baileysLogger = pino({ level: 'silent' });
