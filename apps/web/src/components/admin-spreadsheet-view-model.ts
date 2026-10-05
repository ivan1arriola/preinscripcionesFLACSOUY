export interface SpreadsheetTargetItem {
  targetId: string;
  title: string;
  kind: string;
  spreadsheet?: {
    spreadsheetId: string;
    sheetName: string;
    status?: 'created' | 'reconciled' | 'unchanged' | 'blocked' | 'detached';
    url?: string;
    rootFolderId?: string;
  } | null;
}

export type SpreadsheetTargetKindFilter = 'all' | 'offer' | 'seminar';
export type SpreadsheetTargetStatusFilter = 'all' | 'attention' | 'ready' | 'detached';

export interface SpreadsheetTargetsSummary {
  total: number;
  ready: number;
  attention: number;
  blocked: number;
  detached: number;
}

export function isAttentionTarget(target: SpreadsheetTargetItem): boolean {
  if (!target.spreadsheet) return true;
  return target.spreadsheet.status === 'blocked';
}

export function isReadyTarget(target: SpreadsheetTargetItem): boolean {
  if (!target.spreadsheet?.status) return false;
  return ['created', 'reconciled', 'unchanged'].includes(target.spreadsheet.status);
}

export function isDetachedTarget(target: SpreadsheetTargetItem): boolean {
  return target.spreadsheet?.status === 'detached';
}

export function summarizeSpreadsheetTargets(
  targets: SpreadsheetTargetItem[]
): SpreadsheetTargetsSummary {
  let ready = 0;
  let attention = 0;
  let blocked = 0;
  let detached = 0;

  for (const t of targets) {
    if (isAttentionTarget(t)) {
      attention++;
      if (t.spreadsheet?.status === 'blocked') {
        blocked++;
      }
    } else if (isReadyTarget(t)) {
      ready++;
    } else if (isDetachedTarget(t)) {
      detached++;
    }
  }

  return {
    total: targets.length,
    ready,
    attention,
    blocked,
    detached,
  };
}

function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function filterSpreadsheetTargets(
  targets: SpreadsheetTargetItem[],
  query: string,
  kindFilter: SpreadsheetTargetKindFilter,
  statusFilter: SpreadsheetTargetStatusFilter
): SpreadsheetTargetItem[] {
  const normalizedQuery = normalizeText(query);

  const filtered = targets.filter((target) => {
    // Text search
    if (normalizedQuery) {
      const normalizedTitle = normalizeText(target.title);
      const normalizedId = normalizeText(target.targetId);
      if (!normalizedTitle.includes(normalizedQuery) && !normalizedId.includes(normalizedQuery)) {
        return false;
      }
    }

    // Kind filter
    if (kindFilter === 'offer' && target.kind === 'seminar') {
      return false;
    }
    if (kindFilter === 'seminar' && target.kind !== 'seminar') {
      return false;
    }

    // Status filter
    if (statusFilter === 'attention' && !isAttentionTarget(target)) {
      return false;
    }
    if (statusFilter === 'ready' && !isReadyTarget(target)) {
      return false;
    }
    if (statusFilter === 'detached' && !isDetachedTarget(target)) {
      return false;
    }

    return true;
  });

  // Sort attention first, then alphabetical by title
  return filtered.sort((a, b) => {
    const aAttention = isAttentionTarget(a);
    const bAttention = isAttentionTarget(b);

    if (aAttention && !bAttention) return -1;
    if (!aAttention && bAttention) return 1;

    return a.title.localeCompare(b.title, 'es', { sensitivity: 'base' });
  });
}
