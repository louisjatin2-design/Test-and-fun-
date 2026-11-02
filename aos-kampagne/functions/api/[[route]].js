// Alle /api/*-Anfragen landen hier und werden in src/server.js verarbeitet.
import { handle } from '../../src/server.js';
export const onRequest = (context) => handle(context);
