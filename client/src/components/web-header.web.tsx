import type { ReactNode } from 'react';
import styles from './web-header.module.css';

export function WebHeader({ children }: { children: ReactNode }) {
  return <div className={styles.header}><div className={styles.content}>{children}</div></div>;
}
