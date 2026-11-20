import { File, Paths } from 'expo-file-system';
const file = new File(Paths.document, 'saved-events.json');
export function readSaved(): string { return file.exists ? file.textSync() : '[]'; }
export function writeSaved(value: string) { if (!file.exists) file.create(); file.write(value); }
