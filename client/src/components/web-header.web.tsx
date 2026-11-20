import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, type Href } from 'expo-router';
import { useAuth } from '../auth/auth-context';
import { GoogleSignIn } from '../auth/google-sign-in';
import profileStyles from '../auth/profile.module.css';
import styles from './web-header.module.css';

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
  </dialog>;
}

export function WebHeader({ children }: { children: ReactNode }) {
  const {state,user,signOut}=useAuth();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [signInOpen,setSignInOpen]=useState(false);
  async function leave() {setBusy(true);setError('');try{await signOut();}catch{setError('Nepavyko atsijungti.');}finally{setBusy(false);}}
  return <div className={styles.header}><div className={styles.content}>
    {children}
    <nav className={styles.desktopNav} aria-label="Pagrindinė navigacija"><Link href="/">Visi renginiai</Link><Link href={'/saved' as Href}>Išsaugoti</Link><Link href={'/following' as Href}>Seku</Link></nav>
    {state==='loading' ? <span className={styles.status}>Kraunama...</span> : state==='signed-in' && user ?
      <details className={styles.menu}><summary className={styles.account} aria-label={`Mano paskyra: ${user.displayName}`}>
        {user.profileImageUrl ? <img src={user.profileImageUrl} alt="" className={styles.avatar} referrerPolicy="no-referrer" /> : <span className={styles.avatarFallback} aria-hidden="true">{Array.from(user.displayName)[0]?.toLocaleUpperCase()}</span>}
        <span className={styles.accountName}>{user.displayName}</span><span aria-hidden="true">⌄</span>
      </summary><div className={styles.menuPanel}>
        <Link href={'/profile' as Href} className={styles.menuItem}>Mano paskyra</Link>
        <button className={styles.menuItem} onClick={()=>void leave()} disabled={busy}>{busy?'Atsijungiama...':'Atsijungti'}</button>
        {error && <p role="alert" className={styles.menuError}>{error}</p>}
      </div></details> : state==='unavailable' ? <Link href={'/profile' as Href} className={styles.signIn}>Paskyra</Link> : <button type="button" className={styles.signIn} onClick={()=>setSignInOpen(true)}>Prisijungti</button>}
    {signInOpen && <SignInDialog onClose={()=>setSignInOpen(false)} />}
  </div></div>;
}
