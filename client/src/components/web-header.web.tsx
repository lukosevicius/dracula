import '../global.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, type Href } from 'expo-router';
import { useAuth } from '../auth/auth-context';
import { GoogleSignIn } from '../auth/google-sign-in';
import profileStyles from '../auth/profile.module.css';
import styles from './web-header.module.css';
import { artistsEnabled } from '../constants/features';

function ProfileIcon() {
  return <svg className={styles.profileIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20c.5-4 3.3-6 7.5-6s7 2 7.5 6" /></svg>;
}

function SignInDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { state } = useAuth();
  useEffect(() => { if (dialog.current && !dialog.current.open) dialog.current.showModal(); }, []);
  useEffect(() => { if (state === 'signed-in') dialog.current?.close(); }, [state]);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="sign-in-title" onClose={onClose}>
    <button className={styles.closeDialog} type="button" onClick={() => dialog.current?.close()} aria-label="Uždaryti">×</button>
    <p className={profileStyles.eyebrow}>DRACULA</p>
    <h2 id="sign-in-title" className={profileStyles.heading}>Mano paskyra</h2>
    <p className={profileStyles.secondary}>Prisijunkite prie savo Dracula paskyros.</p>
    <GoogleSignIn />
    <p className={styles.dialogLegal}>Kaip tvarkome jūsų duomenis: <Link href={'/privatumas' as Href} onPress={() => dialog.current?.close()}>Privatumas</Link></p>
  </dialog>;
}

export function WebHeader({ children }: { children: ReactNode }) {
  const {state,user,signOut}=useAuth();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [signInOpen,setSignInOpen]=useState(false);
  const menu=useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (menu.current?.open && event.target instanceof Node && !menu.current.contains(event.target)) menu.current.open=false;
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key==='Escape' && menu.current?.open) { menu.current.open=false; menu.current.querySelector('summary')?.focus(); }
    }
    document.addEventListener('pointerdown',closeOutside);
    document.addEventListener('keydown',closeOnEscape);
    return () => { document.removeEventListener('pointerdown',closeOutside); document.removeEventListener('keydown',closeOnEscape); };
  }, []);
  async function leave() {setBusy(true);setError('');try{await signOut();}catch{setError('Nepavyko atsijungti.');}finally{setBusy(false);}}
  return <div className={styles.header}><div className={styles.content}>
    {children}
    <nav className={styles.desktopNav} aria-label="Pagrindinė navigacija"><Link href="/">Visi renginiai</Link><Link href={'/saved' as Href}>Išsaugoti</Link>{artistsEnabled ? <Link href={'/following' as Href}>Seku</Link> : null}</nav>
    {state==='loading' ? <span className={styles.status}>Kraunama...</span> : state==='signed-in' && user ?
      <details className={styles.menu} ref={menu}><summary className={styles.account} aria-label={`Mano paskyra: ${user.displayName}`}>
        <ProfileIcon /><span className={styles.accountLabel}>Profilis</span>
      </summary><div className={styles.menuPanel}>
        <Link href={'/profile' as Href} className={styles.menuItem} onPress={()=>{if(menu.current)menu.current.open=false;}}>Mano paskyra</Link>
        <Link href={'/privatumas' as Href} className={styles.menuItem} onPress={()=>{if(menu.current)menu.current.open=false;}}>Privatumas</Link>
        <button className={styles.menuItem} onClick={()=>void leave()} disabled={busy}>{busy?'Atsijungiama...':'Atsijungti'}</button>
        {error && <p role="alert" className={styles.menuError}>{error}</p>}
      </div></details> : state==='unavailable' ? <Link href={'/profile' as Href} className={styles.signIn} aria-label="Profilis"><ProfileIcon /><span className={styles.accountLabel}>Profilis</span></Link> : <button type="button" className={styles.signIn} aria-label="Prisijungti" onClick={()=>setSignInOpen(true)}><ProfileIcon /><span className={styles.accountLabel}>Prisijungti</span></button>}
    {signInOpen && <SignInDialog onClose={()=>setSignInOpen(false)} />}
  </div></div>;
}
