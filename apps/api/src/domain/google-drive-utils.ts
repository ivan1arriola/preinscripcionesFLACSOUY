export function extractDriveFolderId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
}

export function isValidDriveFolderId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{10,100}$/.test(id);
}
