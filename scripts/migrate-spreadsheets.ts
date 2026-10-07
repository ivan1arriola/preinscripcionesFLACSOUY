#!/usr/bin/env tsx
import { runSpreadsheetMigrationCli } from '../apps/api/src/migrate-spreadsheets.js';

runSpreadsheetMigrationCli().catch((err) => {
  console.error('Error no controlado:', err);
  process.exit(1);
});
