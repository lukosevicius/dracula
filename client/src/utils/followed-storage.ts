import { File, Paths } from 'expo-file-system';
const file = new File(Paths.document, 'followed-artists.json');
export function readFollowed(): string { return file.exists ? file.textSync() : '[]'; }
export function writeFollowed(value: string) { if (!file.exists) file.create(); file.write(value); }
