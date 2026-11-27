import { useCallback } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';

export const siteTitle = 'Dracula – gyvos muzikos renginiai Lietuvoje';
export const siteDescription = 'Gyvos muzikos renginiai Vilniuje, Kaune, Klaipėdoje ir visoje Lietuvoje: koncertai, festivaliai ir vakarai, kuriuos verta atrasti.';

/**
 * Sets the browser tab title and search description for the current page, each time the page comes into focus
 * (also when going back to it). Event pages also get theirs from web/event.php on first load, so link previews
 * and crawlers that do not run JavaScript see it too.
 */
export function PageTitle({ title, description = siteDescription }: { title: string; description?: string }) {
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.title = title;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta); }
    meta.content = description;
  }, [title, description]));
  return null;
}
