import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

const threshold = 76;

function scrollContainer(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return document.scrollingElement;
  for (let element: Element | null = target; element; element = element.parentElement) {
    const style = window.getComputedStyle(element);
    if (/(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) return element;
  }
  return document.scrollingElement;
}

export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !('ontouchstart' in window)) return;

    let startY: number | null = null;
    let startX: number | null = null;
    let currentPull = 0;
    let canPull = false;

    function onStart(event: TouchEvent) {
      if (event.touches.length !== 1 || refreshing) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"], [data-no-pull-refresh], #dracula-bottom-nav')) return;
      const touch = event.touches[0];
      const scroller = scrollContainer(target);
      canPull = !scroller || scroller.scrollTop <= 0;
      startY = canPull ? touch.clientY : null;
      startX = canPull ? touch.clientX : null;
      currentPull = 0;
    }

    function onMove(event: TouchEvent) {
      if (startY === null || !canPull || event.touches.length !== 1) return;
      const delta = event.touches[0].clientY - startY;
      const deltaX = event.touches[0].clientX - (startX ?? event.touches[0].clientX);
      if (Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(delta)) {
        startY = null;
        currentPull = 0;
        setPull(0);
        return;
      }
      if (delta <= 0) {
        currentPull = 0;
        setPull(0);
        return;
      }
      if (delta > 8) event.preventDefault();
      currentPull = Math.min(delta, threshold + 24);
      setPull(currentPull);
    }

    function onEnd() {
      if (currentPull >= threshold) {
        setRefreshing(true);
        setPull(threshold);
        window.setTimeout(() => window.location.reload(), 400);
      } else {
        setPull(0);
      }
      startY = null;
      startX = null;
      currentPull = 0;
      canPull = false;
    }

    function onCancel() {
      startY = null;
      startX = null;
      currentPull = 0;
      canPull = false;
      setPull(0);
    }

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onCancel);
    };
  }, [refreshing]);

  if (Platform.OS !== 'web' || (pull === 0 && !refreshing)) return null;
  const translateY = Math.max(-42, Math.min(0, pull * 0.45 - 42));

  return <div className="dracula-pull-refresh-indicator" role="status" aria-label={refreshing ? 'Atnaujinama' : 'Patraukite, kad atnaujintumėte'} style={{ transform: `translate(-50%, ${translateY}px)` }}>
    <span className={`dracula-pull-refresh-icon${refreshing ? ' is-refreshing' : ''}`} aria-hidden="true">⚙️</span>
  </div>;
}
