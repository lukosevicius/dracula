import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthError, getChallenge, googleLogin } from './auth-api';
import { useAuth } from './auth-context';
import styles from './profile.module.css';

const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || '819033924711-1bra57fss49501nc74o8eers1kh6nvrq.apps.googleusercontent.com';
type GoogleIdentity = { initialize: (config: {client_id: string; nonce: string; callback: (response: {credential?: string}) => void; error_callback: (error: {type: string}) => void}) => void; renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void; cancel: () => void };
declare global { interface Window { google?: {accounts: {id: GoogleIdentity}} } }
let scriptPromise: Promise<void> | undefined;
function loadGoogle(): Promise<void> {
  if (window.google?.accounts.id) return Promise.resolve();
  if (!scriptPromise) scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script'); script.src='https://accounts.google.com/gsi/client'; script.async=true;
    script.onload=()=>window.google?.accounts.id ? resolve() : reject(new Error('Google unavailable'));
    script.onerror=()=>{script.remove(); reject(new Error('Google unavailable'));}; document.head.appendChild(script);
  }).catch(error=>{scriptPromise=undefined; throw error;});
  return scriptPromise;
}

/**
 * Resolves once Google's button has stopped changing. Google first draws a generic button and, for someone
 * signed in to Google, swaps in a personalised one a moment later; showing only the settled result avoids the jump.
 */
function whenSettled(element: HTMLElement, quietMs = 300, maxMs = 2500) {
  return new Promise<void>(resolve => {
    let timer = 0;
    const loaded = new WeakSet<EventTarget>();
    const finish = () => { window.clearTimeout(timer); window.clearTimeout(cap); mutations.disconnect(); resize.disconnect(); element.removeEventListener('load', onLoad, true); resolve(); };
    // The personalised button arrives in an iframe; wait for it to load even if that takes longer than the quiet period.
    const settled = () => [...element.querySelectorAll('iframe')].every(frame => loaded.has(frame)) ? finish() : undefined;
    const restart = () => { window.clearTimeout(timer); timer = window.setTimeout(settled, quietMs); };
    const onLoad = (event: Event) => { if (event.target) loaded.add(event.target); restart(); };
    const cap = window.setTimeout(finish, maxMs);
    const mutations = new MutationObserver(restart);
    mutations.observe(element, { childList: true, subtree: true, attributes: true });
    const resize = new ResizeObserver(restart);
    resize.observe(element);
    element.addEventListener('load', onLoad, true);
    restart();
  });
}

export function GoogleSignIn() {
  const { setSignedIn } = useAuth();
  const button = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const [step, setStep] = useState<'loading'|'ready'|'signing-in'|'expired'>('loading');
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState(false);
  const start = useCallback(async () => {
    const current=++sequence.current; setStep('loading'); setError(''); setRevealed(false);
    try {
      const [{nonce}] = await Promise.all([getChallenge(), loadGoogle()]);
      if (current!==sequence.current || !button.current || !window.google?.accounts.id) return;
      const google=window.google.accounts.id;
      google.initialize({client_id:clientId,nonce,callback:async (response)=>{
        if (current!==sequence.current) return;
        if (!response.credential) { setError('Nepavyko prisijungti. Bandykite dar kartą.'); setStep('expired'); return; }
        setStep('signing-in');
        try {const {user}=await googleLogin(response.credential); if(current===sequence.current) setSignedIn(user);}
        catch (failure) {if(current===sequence.current) {setError(failure instanceof AuthError && failure.status===401 ? 'Prisijungimo laikas baigėsi. Bandykite dar kartą.' : 'Nepavyko prisijungti. Patikrinkite ryšį ir bandykite dar kartą.');setStep('expired');}}
      },error_callback:()=>{if(current===sequence.current){setError('Prisijungimas nutrauktas. Bandykite dar kartą.');setStep('expired');}}});
      const width = Math.min(280, button.current.parentElement?.clientWidth || 280);
      button.current.replaceChildren(); google.renderButton(button.current,{theme:'outline',size:'large',text:'continue_with',shape:'pill',width}); setStep('ready');
      await whenSettled(button.current);
      if (current===sequence.current) setRevealed(true);
    } catch {if(current===sequence.current){setError('Nepavyko paruošti prisijungimo. Bandykite dar kartą.');setStep('expired');}}
  },[setSignedIn]);
  useEffect(()=>{void start();return()=>{sequence.current++;window.google?.accounts.id.cancel();};},[start]);
  useEffect(()=>{if(step!=='ready') return; const timer=window.setTimeout(()=>{sequence.current++;setStep('expired');setError('Prisijungimo laikas baigėsi. Bandykite dar kartą.');},4*60*1000);return()=>window.clearTimeout(timer);},[step]);
  return <div className={styles.signIn}>
    {step==='expired' && <button className={styles.primaryButton} onClick={()=>void start()}>Bandyti dar kartą</button>}
    {step==='signing-in' && <p role="status">Jungiama...</p>}
    {/* A fixed slot: a placeholder holds the place until Google's button has settled, then the button fades in. */}
    <div className={styles.googleSlot} hidden={step!=='loading' && step!=='ready'}>
      {!revealed && <div className={styles.googlePlaceholder} role="status" aria-label="Ruošiamas prisijungimas" />}
      <div ref={button} className={`${styles.googleButton} ${revealed ? styles.googleButtonShown : ''}`} aria-hidden={!revealed} />
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}
