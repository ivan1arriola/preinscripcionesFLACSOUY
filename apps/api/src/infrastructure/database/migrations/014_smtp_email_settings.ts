import type { Kysely } from 'kysely';

const SMTP_DEFAULT_SETTINGS = [
  ['email_provider', 'smtp', 'Proveedor de correo activo'],
  ['smtp_host', 'email-smtp.us-east-1.amazonaws.com', 'Servidor SMTP'],
  ['smtp_port', '587', 'Puerto SMTP'],
  ['smtp_security', 'starttls', 'Seguridad SMTP'],
  ['smtp_username', '', 'Usuario SMTP'],
  ['email_from', '', 'Remitente de correo'],
  ['email_reply_to', '', 'Dirección de respuesta'],
  ['smtp_last_connection_test_at', '', 'Fecha de la última verificación SMTP'],
  ['smtp_last_connection_test_ok', '', 'Resultado de la última verificación SMTP'],
  ['smtp_last_connection_test_error', '', 'Error seguro de la última verificación SMTP'],
] as const;

export async function up(db: Kysely<any>): Promise<void> {
  await db
    .insertInto('system_settings')
    .values(
      SMTP_DEFAULT_SETTINGS.map(([key, value, description]) => ({
        key,
        value,
        description,
      })),
    )
    .onConflict((conflict) => conflict.column('key').doNothing())
    .execute();
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Deliberately additive: rollback must not remove SMTP credentials saved later.
}
