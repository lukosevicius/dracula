const key = 'dracula-followed-artists';
export function readFollowed(): string { return localStorage.getItem(key) || '[]'; }
export function writeFollowed(value: string) { localStorage.setItem(key, value); }
