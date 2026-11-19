import { useState, type ReactNode } from 'react';
import { Link } from 'expo-router';
import { useAuth } from '../auth/auth-context';
import styles from './web-header.module.css';

export function WebHeader({ children }: { children: ReactNode }) {
  const {state,user,signOut}=useAuth();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function leave() {setBusy(true);setError('');try{await signOut();}catch{setError('Nepavyko atsijungti.');}finally{setBusy(false);}}
  return <div className={styles.header}><div className={styles.content}>
    {children}
    {state==='loading' ? <span className={styles.status}>Kraunama...</span> : state==='signed-in' && user ?
      <details className={styles.menu}><summary className={styles.account} aria-label={`Mano paskyra: ${user.displayName}`}>
        {user.profileImageUrl ? <img src={user.profileImageUrl} alt="" className={styles.avatar} referrerPolicy="no-referrer" /> : <span className={styles.avatarFallback} aria-hidden="true">{Array.from(user.displayName)[0]?.toLocaleUpperCase()}</span>}
        <span className={styles.accountName}>{user.displayName}</span><span aria-hidden="true">⌄</span>
      </summary><div className={styles.menuPanel}>
        <Link href="./profile" className={styles.menuItem}>Mano paskyra</Link>
        <button className={styles.menuItem} onClick={()=>void leave()} disabled={busy}>{busy?'Atsijungiama...':'Atsijungti'}</button>
        {error && <p role="alert" className={styles.menuError}>{error}</p>}
      </div></details> : <Link href="./profile" className={styles.signIn}>{state==='unavailable'?'Paskyra':'Prisijungti'}</Link>}
  </div></div>;
}
