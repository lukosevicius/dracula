import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'expo-router';
import { GoogleSignIn } from './google-sign-in';
import { useAuth } from './auth-context';
import styles from './profile.module.css';

export function ProfileScreen() {
  const {state,user,refresh,saveName,signOut,removeAccount}=useAuth();
  const [name,setName]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [confirmDelete,setConfirmDelete]=useState(false);
  useEffect(()=>{setName(user?.displayName ?? '');},[user]);
  async function save(event: FormEvent) {
    event.preventDefault(); const value=name.trim(); setError('');setMessage('');
    if(!value || Array.from(value).length>191){setError('Įveskite vardą (iki 191 simbolio).');return;}
    setBusy(true);try{await saveName(value);setMessage('Vardas išsaugotas.');}catch{setError('Nepavyko išsaugoti vardo. Bandykite dar kartą.');}finally{setBusy(false);}
  }
  async function leave() { setBusy(true);setError('');try{await signOut();}catch{setError('Nepavyko atsijungti. Bandykite dar kartą.');}finally{setBusy(false);} }
  async function remove() {setBusy(true);setError('');try{await removeAccount();setConfirmDelete(false);setMessage('Paskyra ištrinta.');}catch{setError('Nepavyko ištrinti paskyros. Bandykite dar kartą.');}finally{setBusy(false);}}
  return <main className={styles.page}><Link href="/" className={styles.back}>← Visi renginiai</Link>
    <section className={styles.card}>
      <p className={styles.eyebrow}>DRACULA</p><h1 className={styles.heading}>Mano paskyra</h1>
      {state==='loading' && <p role="status" className={styles.secondary}>Kraunama paskyra...</p>}
      {state==='unavailable' && <><p role="alert" className={styles.error}>Nepavyko patikrinti prisijungimo. Bandykite dar kartą.</p><button className={styles.secondaryButton} onClick={()=>void refresh()}>Bandyti dar kartą</button></>}
      {state==='signed-out' && <>{message && <p role="status" className={styles.success}>{message}</p>}<p className={styles.secondary}>Prisijunkite prie savo Dracula paskyros.</p><GoogleSignIn /></>}
      {state==='signed-in' && user && <>
        <div className={styles.user}>{user.profileImageUrl ? <img className={styles.avatar} src={user.profileImageUrl} alt="" referrerPolicy="no-referrer" /> : <div className={styles.avatarFallback} aria-hidden="true">{Array.from(user.displayName)[0]?.toLocaleUpperCase()}</div>}<div><p className={styles.userLabel}>Prisijungėte kaip</p><p className={styles.userName}>{user.displayName}</p></div></div>
        <form onSubmit={event=>void save(event)} className={styles.form}><label htmlFor="display-name">Vardas</label><input id="display-name" value={name} onChange={event=>setName(event.target.value)} autoComplete="name" maxLength={382} disabled={busy} /><button className={styles.primaryButton} type="submit" disabled={busy||name.trim()===user.displayName}>{busy?'Palaukite...':'Išsaugoti'}</button></form>
        {message && <p role="status" className={styles.success}>{message}</p>}{error && <p role="alert" className={styles.error}>{error}</p>}
        <button className={styles.secondaryButton} onClick={()=>void leave()} disabled={busy}>Atsijungti</button>
        <div className={styles.deleteSection}>
          <h2>Paskyros duomenys</h2>
          <p>Dracula saugo jūsų vardą, „Google“ paskyros identifikatorių, nuotraukos nuorodą ir prisijungimo sesijas. Pašalinus paskyrą šie duomenys ištrinami iš aktyvios sistemos ir atsijungiama visuose įrenginiuose.</p>
          {!confirmDelete ? <button className={styles.deleteButton} type="button" onClick={()=>setConfirmDelete(true)} disabled={busy}>Ištrinti paskyrą</button> : <div role="group" aria-label="Paskyros ištrynimo patvirtinimas"><p>Ar tikrai norite ištrinti paskyrą? Šio veiksmo atšaukti negalėsite.</p><div className={styles.deleteActions}><button className={styles.deleteButton} type="button" onClick={()=>void remove()} disabled={busy}>{busy?'Trinama...':'Taip, ištrinti paskyrą'}</button><button className={styles.secondaryButton} type="button" onClick={()=>setConfirmDelete(false)} disabled={busy}>Atšaukti</button></div></div>}
        </div>
      </>}
    </section>
    <p className={styles.legal}>Kaip tvarkome jūsų duomenis: <Link href="/privatumas">Privatumas</Link></p>
  </main>;
}
