import { useCallback } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { siteUrl } from '../utils/event-url';

export const siteTitle = 'Dracula – gyvos muzikos renginiai Lietuvoje';
export const siteDescription = 'Gyvos muzikos renginiai Vilniuje, Kaune, Klaipėdoje ir visoje Lietuvoje: koncertai, festivaliai ir vakarai, kuriuos verta atrasti.';

function headTag<T extends HTMLElement>(selector: string, create: () => T): T {
  return document.head.querySelector<T>(selector) ?? document.head.appendChild(create());
}

/**
 * Sets the browser tab title, search description and canonical address for the current page, each time the page
 * comes into focus (also when going back to it). The canonical address is https://dracula.lt plus `path` (default:
 * the current path), never with ?nostats, ?fbclid or other query text, so search engines count one address per page.
 * `noindex` asks search engines to leave the page out (past events). Event pages also get all of this from
 * web/event.php on first load, so link previews and crawlers that do not run JavaScript see it too.
 */
export function PageTitle({ title, description = siteDescription, path, noindex = false }: { title: string; description?: string; path?: string; noindex?: boolean }) {
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.title = title;
    headTag('meta[name="description"]', () => Object.assign(document.createElement('meta'), { name: 'description' })).content = description;
    const current = (path ?? window.location.pathname).replace(/\/+$/, '') || '/';
    headTag('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' })).href = siteUrl + current;
    const robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (noindex) headTag('meta[name="robots"]', () => Object.assign(document.createElement('meta'), { name: 'robots' })).content = 'noindex';
    else robots?.remove();
  }, [title, description, path, noindex]));
  return null;
}
