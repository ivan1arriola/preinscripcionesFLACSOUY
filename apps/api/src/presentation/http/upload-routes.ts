import Busboy from 'busboy';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { FileStorageError, type FileStorageErrorCode } from '../../infrastructure/files/temporary-file-storage.js';
import type { TemporaryFileStoragePort } from '../../ports/file-storage.js';
import type { AcademicCatalog } from '../../ports/academic-catalog.js';
import { getCanonicalFormDefinition } from '../../domain/canonical-forms.js';

const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB per file
const MAX_TOTAL_SESSION_BYTES = 60 * 1024 * 1024; // 60 MiB total per preinscription (hasta 2 archivos por campo)

const STORAGE_ERROR_STATUS: Partial<Record<FileStorageErrorCode, number>> = {
  NOT_FOUND: 404,
  OFFSET_MISMATCH: 409,
  UPLOAD_INCOMPLETE: 409,
  INVALID_MIME_TYPE: 400,
  FILE_TOO_LARGE: 400,
};

interface Rejection { status: number; code: string; message: string }

const beginSchema = z.object({
  targetId: z.string().min(1).max(128),
  fieldKey: z.string().min(1).max(128),
  mimeType: z.string().min(1).max(128),
  originalName: z.string().min(1).max(255),
  size: z.number().int().min(1).max(MAX_UPLOAD_FILE_BYTES),
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Verifica los primeros bytes del archivo contra el tipo que declaró el cliente. */
export function matchesDeclaredType(buffer: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case 'application/pdf':
      // La especificación admite basura previa: el marcador debe aparecer en el primer KiB.
      return buffer.subarray(0, 1024).includes('%PDF-', 0, 'latin1');
    case 'image/jpeg':
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/png':
      return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
    case 'image/webp':
      return buffer.length >= 12
        && buffer.subarray(0, 4).toString('latin1') === 'RIFF'
        && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
    default:
      return false;
  }
}

export function createUploadRoutes(
  storage: TemporaryFileStoragePort,
  catalog?: AcademicCatalog
): Router {
  const router = Router();

  /** Reglas del campo documental (cantidad y suma de bytes). Devuelve el rechazo o null; sin catálogo no hay reglas. */
  async function checkFieldQuota(
    sessionId: string,
    upload: { targetId?: string; fieldKey: string; mimeType?: string; size: number },
    inProgress?: number,
  ): Promise<Rejection | null> {
    if (!catalog || !upload.targetId) return null;
    const { targetId, fieldKey, mimeType, size } = upload;
    const target = (await catalog.getTarget(targetId)) ?? (await catalog.revalidateTarget(targetId));
    if (!target) return { status: 404, code: 'NOT_FOUND', message: `Destino académico no encontrado: ${targetId}` };
    if (!target.registrationOpen) return { status: 400, code: 'REGISTRATION_CLOSED', message: 'La preinscripción se encuentra cerrada.' };
    const form = getCanonicalFormDefinition(target);
    if (!form.ok) return { status: 400, code: 'INCOMPATIBLE_FORM', message: form.error.message };
    const document = form.value.documents.find((item) => item.key === fieldKey);
    if (!document) return { status: 400, code: 'INVALID_FIELD', message: `El campo documental "${fieldKey}" no corresponde a esta propuesta.` };
    if (mimeType && document.acceptedMimeTypes?.length && !document.acceptedMimeTypes.includes(mimeType)) {
      return { status: 400, code: 'INVALID_MIME_TYPE', message: `Tipo de archivo no permitido: ${mimeType}.` };
    }
    if (size > (document.maxBytes ?? MAX_UPLOAD_FILE_BYTES)) {
      return { status: 400, code: 'FILE_TOO_LARGE', message: `El archivo supera el tamaño máximo permitido para "${document.label}".` };
    }
    const maxFiles = document.maxFiles ?? 1;
    const current = await storage.listBySession?.(sessionId) ?? [];
    const finished = current.filter((item) => item.fieldKey === fieldKey).length;
    // Holgura de 2 cargas en curso para no bloquear a quien abandonó un intento.
    if (finished >= maxFiles || (inProgress !== undefined && finished + inProgress >= maxFiles + 2)) {
      return { status: 400, code: 'MAX_FILES_EXCEEDED', message: `Ya se alcanzó el número máximo de archivos (${maxFiles}) para el campo "${document.label}".` };
    }
    if (current.reduce((total, item) => total + item.size, 0) + size > MAX_TOTAL_SESSION_BYTES) {
      return { status: 400, code: 'TOTAL_SIZE_EXCEEDED', message: 'La suma de archivos de la preinscripción no puede superar 60 MiB.' };
    }
    return null;
  }

  /** Mapea errores de dominio del almacenamiento a HTTP; el resto sigue al manejador general. */
  function sendStorageError(error: unknown, res: Response, next: NextFunction): void {
    const status = error instanceof FileStorageError ? STORAGE_ERROR_STATUS[error.code] : undefined;
    if (!status || !(error instanceof FileStorageError)) { next(error); return; }
    res.status(status).json({ error: { code: error.code, message: error.message } });
  }

  router.post('/resumable', async (req, res, next) => {
    const sessionId = req.header('x-preinscription-session')?.trim();
    const parsed = beginSchema.safeParse(req.body ?? {});
    if (!sessionId || !parsed.success) {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Faltan datos para iniciar la carga.' } });
      return;
    }
    if (!storage.beginResumable) {
      res.status(501).json({ error: { code: 'NOT_SUPPORTED', message: 'La carga reanudable no está disponible.' } });
      return;
    }
    const { targetId, fieldKey, originalName, mimeType, size } = parsed.data;
    try {
      const rejection = await checkFieldQuota(sessionId, { targetId, fieldKey, mimeType, size }, await storage.countResumable?.(sessionId, fieldKey) ?? 0);
      if (rejection) {
        res.status(rejection.status).json({ error: { code: rejection.code, message: rejection.message } });
        return;
      }
      res.status(201).json(await storage.beginResumable(sessionId, fieldKey, { targetId, originalName, mimeType, size }));
    } catch (error) {
      sendStorageError(error, res, next);
    }
  });

  router.head('/resumable/:uploadId', async (req, res) => {
    const sessionId = req.header('x-preinscription-session')?.trim();
    if (!sessionId || !storage.getResumableOffset) { res.sendStatus(400); return; }
    try {
      res.setHeader('Upload-Offset', String(await storage.getResumableOffset(req.params.uploadId, sessionId)));
      res.sendStatus(204);
    } catch (error) {
      res.sendStatus(error instanceof FileStorageError && error.code === 'NOT_FOUND' ? 404 : 500);
    }
  });

  router.patch('/resumable/:uploadId', (req, res, next) => {
    const sessionId = req.header('x-preinscription-session')?.trim();
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.header('content-range') ?? '');
    if (!sessionId || !match || !storage.appendResumable) { res.sendStatus(400); return; }
    const chunks: Buffer[] = [];
    let received = 0;
    req.on('data', (chunk: Buffer) => {
      received += chunk.byteLength;
      if (received > MAX_UPLOAD_FILE_BYTES) req.destroy();
      else chunks.push(chunk);
    });
    req.on('error', next);
    req.on('end', async () => {
      try {
        const expected = Number(match[2]) - Number(match[1]) + 1;
        if (received !== expected) { res.sendStatus(400); return; }
        const offset = await storage.appendResumable!(req.params.uploadId, sessionId, Number(match[1]), Buffer.concat(chunks));
        res.setHeader('Upload-Offset', String(offset));
        res.sendStatus(204);
      } catch (error) {
        sendStorageError(error, res, next);
      }
    });
  });

  router.post('/resumable/:uploadId/complete', async (req, res, next) => {
    const sessionId = req.header('x-preinscription-session')?.trim();
    if (!sessionId || !storage.finishResumable) { res.sendStatus(400); return; }
    // Las cargas pudieron empezar en paralelo: los límites se comprueban de nuevo contra lo ya terminado.
    const rejected: { value?: Rejection } = {};
    try {
      const saved = await storage.finishResumable(req.params.uploadId, sessionId, async (upload) => {
        rejected.value = await checkFieldQuota(sessionId, upload) ?? undefined;
        if (rejected.value) throw new Error(rejected.value.code);
      });
      const uploaded = await storage.open(saved.token, sessionId);
      if (!matchesDeclaredType(uploaded.data, uploaded.mimeType)) {
        await storage.remove(saved.token, sessionId);
        res.status(400).json({ error: { code: 'INVALID_FILE_CONTENT', message: 'El contenido del archivo no coincide con su tipo. Subí un PDF, JPG, PNG o WebP válido.' } });
        return;
      }
      res.status(201).json({ token: saved.token, fieldKey: saved.fieldKey, originalName: saved.originalName, size: saved.size, mimeType: saved.mimeType });
    } catch (error) {
      if (rejected.value) {
        res.status(rejected.value.status).json({ error: { code: rejected.value.code, message: rejected.value.message } });
        return;
      }
      sendStorageError(error, res, next);
    }
  });

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

        // Sin destino no se pueden aplicar las reglas del campo (tipo, tamaño, cantidad): no se acepta el archivo.
        if (catalog && !targetId) {
          res.status(400).json({
            error: {
              code: 'INVALID_REQUEST',
              message: 'El destino académico (targetId) es obligatorio para cargar un archivo.',
            },
          });
          return;
        }

        // Algunos dispositivos envían fotos con un tipo genérico. Solo se aceptan si la firma corresponde a un formato admitido.
        if (mimeType === 'application/octet-stream' || !mimeType) {
          mimeType = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
            .find((candidate) => matchesDeclaredType(buffer, candidate)) ?? mimeType;
        }
        // Los tipos específicos deben coincidir con el contenido real.
        if (!matchesDeclaredType(buffer, mimeType)) {
          res.status(400).json({
            error: {
              code: 'INVALID_FILE_CONTENT',
              message: 'El contenido del archivo no coincide con su tipo. Subí un PDF, JPG, PNG o WebP válido.',
            },
          });
          return;
        }

        if (catalog && targetId) {
          const target = (await catalog.getTarget(targetId)) ?? (await catalog.revalidateTarget(targetId));
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
            const sessionFiles = storage.listPendingBySession
              ? await storage.listPendingBySession(sessionId)
              : await storage.listBySession(sessionId);
            const existingForField = sessionFiles.filter((f) => f.fieldKey === fieldKey && f.targetId === targetId);
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
                  message: 'La suma de archivos de la preinscripción no puede superar 60 MiB.',
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

  // Aviso periódico del formulario abierto: renueva el vencimiento de los archivos de la sesión. Sin esto vencen
  // 30 minutos después de la última subida aunque la persona siga completando el formulario, y se pierden.
  router.post('/keepalive', async (req, res) => {
    const sessionId = req.header('x-preinscription-session')?.trim();
    if (!sessionId) {
      res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'La sesión de preinscripción es obligatoria.' },
      });
      return;
    }
    try {
      await storage.touch?.(sessionId);
      res.status(200).json({ ok: true });
    } catch {
      res.status(503).json({
        error: { code: 'KEEPALIVE_UNAVAILABLE', message: 'No se pudo renovar la sesión; se reintentará.' },
      });
    }
  });

  router.delete('/:token', async (req, res) => {
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
      // Borrado público: solo pendientes. Un archivo ya fijado por un envío nunca se borra desde aquí.
      if (storage.removePending) await storage.removePending(token, sessionId);
      else await storage.remove(token, sessionId);
      res.status(200).json({ ok: true });
    } catch (error) {
      if ((error as { code?: string }).code === 'FILE_ALREADY_SUBMITTED') {
        res.status(409).json({
          error: {
            code: 'FILE_ALREADY_SUBMITTED',
            message: 'El archivo ya forma parte de una preinscripción enviada y no se puede eliminar.',
          },
        });
        return;
      }
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
