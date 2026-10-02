import Busboy from 'busboy';
import { Router, type Request } from 'express';
import type { TemporaryFileStoragePort } from '../../ports/file-storage.js';

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function createUploadRoutes(storage: TemporaryFileStoragePort): Router {
  const router = Router();

  router.post('/', (req, res, next) => {
    const sessionId = req.header('x-preinscription-session')?.trim();
    if (!sessionId) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'La sesión de preinscripción es obligatoria.' } });
      return;
    }

    let fieldKey = '';
    let fileName = '';
    let mimeType = '';
    let fileTooLarge = false;
    const chunks: Buffer[] = [];
    let sawFile = false;
    const parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_UPLOAD_BYTES } });
    parser.on('field', (name, value) => {
      if (name === 'fieldKey') fieldKey = value.trim();
    });
    parser.on('file', (_name, stream, info) => {
      sawFile = true;
      fileName = info.filename;
      mimeType = info.mimeType;
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => { fileTooLarge = true; });
    });
    parser.on('error', next);
    parser.on('finish', async () => {
      try {
        if (!sawFile || !fieldKey || fileTooLarge) {
          res.status(400).json({ error: { code: 'INVALID_FILE', message: fileTooLarge ? 'El archivo supera el tamaño máximo permitido.' : 'El campo y el archivo son obligatorios.' } });
          return;
        }
        const saved = await storage.save(sessionId, fieldKey, {
          originalName: fileName,
          mimeType,
          data: Buffer.concat(chunks),
        });
        res.status(201).json({
          token: saved.token,
          fieldKey: saved.fieldKey,
          originalName: saved.originalName,
          size: saved.size,
          mimeType: saved.mimeType,
        });
      } catch (error) {
        next(error);
      }
    });
    (req as Request).pipe(parser);
  });

  return router;
}
