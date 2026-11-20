const key = 'dracula-saved-events';
export function readSaved(): string { return localStorage.getItem(key) || '[]'; }
export function writeSaved(value: string) { localStorage.setItem(key, value); }
