/** A short message shown briefly at the bottom of the screen by the web header, such as "Atsijungėte". */
export const notifyEvent = 'dracula:notify';

export function notify(message: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<string>(notifyEvent, { detail: message }));
}
