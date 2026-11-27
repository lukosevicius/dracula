/** Asks the web header to open its sign-in window, so any page can offer signing in without loading Google itself. */
export const signInEvent = 'dracula:open-sign-in';

export function openSignIn() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(signInEvent));
}
