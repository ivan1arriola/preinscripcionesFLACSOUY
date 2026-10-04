import Busboy from 'busboy';
import { Router, type Request } from 'express';
import type { TemporaryFileStoragePort } from '../../ports/file-storage.js';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import { getCanonicalFormDefinition } from '../../domain/canonical-forms.js';

const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB per file
const MAX_TOTAL_SESSION_BYTES = 25 * 1024 * 1024; // 25 MiB total per preinscription

export function createUploadRoutes(
  storage: TemporaryFileStoragePort,
  catalog?: AcademicCatalog
): Router {
  const router = Router();

  router.post('/', (req, res, next) => {
    const sessionId = req.header('x-preinscription-session')?.trim();
    if (!sessionId) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'La sesión de preinscripción es obligatoria.',
        },
      });
      return;
    }

    let targetId = '';
    let fieldKey = '';
    let fileName = '';
    let mimeType = '';
    let fileTooLarge = false;
    const chunks: Buffer[] = [];
    let sawFile = false;

    const parser = Busboy({
      headers: req.headers,
      limits: { files: 1, fileSize: MAX_UPLOAD_FILE_BYTES },
    });

    parser.on('field', (name, value) => {
      if (name === 'targetId') targetId = value.trim();
      if (name === 'fieldKey') fieldKey = value.trim();
    });

    parser.on('file', (_name, stream, info) => {
      sawFile = true;
      fileName = info.filename;
      mimeType = info.mimeType;
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => {
        fileTooLarge = true;
      });
    });

    parser.on('error', next);

    parser.on('finish', async () => {
      try {
        if (fileTooLarge) {
          res.status(400).json({
            error: {
              code: 'FILE_TOO_LARGE',
              message: 'El archivo supera el tamaño máximo permitido de 10 MiB.',
            },
          });
          return;
        }

        if (!sawFile || !fieldKey) {
          res.status(400).json({
            error: {
              code: 'INVALID_FILE',
              message: 'El campo y el archivo son obligatorios.',
            },
          });
          return;
        }

        const buffer = Buffer.concat(chunks);

        if (catalog && targetId) {
          const target = await catalog.revalidateTarget(targetId);
          if (!target) {
            res.status(404).json({
              error: {
                code: 'NOT_FOUND',
                message: `Destino académico no encontrado: ${targetId}`,
              },
            });
            return;
          }

          if (!target.registrationOpen) {
            res.status(400).json({
              error: {
                code: 'REGISTRATION_CLOSED',
                message: 'La preinscripción se encuentra cerrada.',
              },
            });
            return;
          }

          const formRes = getCanonicalFormDefinition(target);
          if (!formRes.ok) {
            res.status(400).json({
              error: {
                code: 'INCOMPATIBLE_FORM',
                message: formRes.error.message,
              },
            });
            return;
          }

          const docDef = formRes.value.documents.find((d) => d.key === fieldKey);
          if (!docDef) {
            res.status(400).json({
              error: {
                code: 'INVALID_FIELD',
                message: `El campo documental "${fieldKey}" no corresponde a esta propuesta.`,
              },
            });
            return;
          }

          if (
            docDef.acceptedMimeTypes &&
            docDef.acceptedMimeTypes.length > 0 &&
            !docDef.acceptedMimeTypes.includes(mimeType)
          ) {
            res.status(400).json({
              error: {
                code: 'INVALID_MIME_TYPE',
                message: `Tipo de archivo no permitido: ${mimeType}. Formatos admitidos: ${docDef.acceptedMimeTypes.join(', ')}`,
              },
            });
            return;
          }

          const maxDocBytes = docDef.maxBytes ?? MAX_UPLOAD_FILE_BYTES;
          if (buffer.length > maxDocBytes) {
            res.status(400).json({
              error: {
                code: 'FILE_TOO_LARGE',
                message: `El archivo supera el tamaño máximo permitido para "${docDef.label}".`,
              },
            });
            return;
          }

          if (storage.listBySession) {
            const sessionFiles = await storage.listBySession(sessionId);
            const existingForField = sessionFiles.filter((f) => f.fieldKey === fieldKey);
            const maxFiles = docDef.maxFiles ?? 1;
            if (existingForField.length >= maxFiles) {
              res.status(400).json({
                error: {
                  code: 'MAX_FILES_EXCEEDED',
                  message: `Ya se alcanzó el número máximo de archivos (${maxFiles}) para el campo "${docDef.label}".`,
                },
              });
              return;
            }

            const currentTotal = sessionFiles.reduce((acc, f) => acc + f.size, 0);
            if (currentTotal + buffer.length > MAX_TOTAL_SESSION_BYTES) {
              res.status(400).json({
                error: {
                  code: 'TOTAL_SIZE_EXCEEDED',
                  message: 'La suma de archivos de la preinscripción no puede superar 25 MiB.',
                },
              });
              return;
            }
          }
        }

        const saved = await storage.save(
          sessionId,
          fieldKey,
          {
            originalName: fileName,
            mimeType,
            data: buffer,
          },
          { targetId: targetId || undefined }
        );

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

  router.delete('/:token', async (req, res, next) => {
    const sessionId = req.header('x-preinscription-session')?.trim();
    if (!sessionId) {
      res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'La sesión de preinscripción es obligatoria.',
        },
      });
      return;
    }

    const { token } = req.params;
    if (!token || !/^[a-f0-9]{32}$/.test(token)) {
      res.status(400).json({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Token de archivo inválido.',
        },
      });
      return;
    }

    try {
      await storage.remove(token, sessionId);
      res.status(200).json({ ok: true });
    } catch {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Archivo no encontrado o no pertenece a la sesión actual.',
        },
      });
    }
  });

  return router;
}
