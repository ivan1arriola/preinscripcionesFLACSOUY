export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ErrorOrigin = 'wordpress' | 'sheets' | 'drive' | 'database' | 'system';
export type ErrorStatus = 'unresolved' | 'resolved';

export interface SystemErrorRecord {
  id: string;
  severity: ErrorSeverity;
  origin: ErrorOrigin;
  code: string;
  message: string;
  context: Record<string, unknown>;
  targetId?: string;
  status: ErrorStatus;
  resolvedAt?: string;
  resolvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSystemErrorInput {
  id?: string;
  severity: ErrorSeverity;
  origin: ErrorOrigin;
  code: string;
  message: string;
  context?: Record<string, unknown>;
  targetId?: string;
  now?: Date;
}

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /api[_-]?key/i,
  /private/i,
  /cedula/i,
  /email/i,
  /phone/i,
  /telefono/i,
  /ci/i,
];

export function sanitizeErrorContext(
  context: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!context || typeof context !== 'object') {
    return {};
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeErrorContext(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) =>
        item && typeof item === 'object'
          ? sanitizeErrorContext(item as Record<string, unknown>)
          : item
      );
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export function createSystemError(input: CreateSystemErrorInput): SystemErrorRecord {
  const nowStr = (input.now || new Date()).toISOString();
  const id = input.id || `err_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  return {
    id,
    severity: input.severity,
    origin: input.origin,
    code: input.code,
    message: input.message,
    context: sanitizeErrorContext(input.context),
    targetId: input.targetId,
    status: 'unresolved',
    createdAt: nowStr,
    updatedAt: nowStr,
  };
}

export function resolveSystemError(
  error: SystemErrorRecord,
  resolvedBy: string,
  now: Date = new Date()
): SystemErrorRecord {
  const nowStr = now.toISOString();
  return {
    ...error,
    status: 'resolved',
    resolvedAt: nowStr,
    resolvedBy,
    updatedAt: nowStr,
  };
}
