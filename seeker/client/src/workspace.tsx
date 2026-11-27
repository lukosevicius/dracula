import { useEffect, useRef, useState, type ReactNode } from 'react';

import { api } from './data';

const logo = new URL('./assets/favicon.png', import.meta.url).href;

const paths = {
  library: 'M4 6v12M8 6v12M12 6v12m3-11 4 11',
  calendar: 'M7 3v4m10-4v4M4 10h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm2 9h2m4 0h2m-8 3h2',
  avilys: 'm12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 5 3.5 2v4L12 16l-3.5-2v-4L12 8Z',
  spark: 'M12 2c0 6 4 10 10 10-6 0-10 4-10 10 0-6-4-10-10-10 6 0 10-4 10-10Z',
  search: 'M21 21l-4.3-4.3M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
  external: 'M13 5h6v6m0-6-9 9m7 0v5H5V7h5',
  download: 'M12 3v12m-4-4 4 4 4-4m-12 5v4h16v-4',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-5v5l3 2',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12 4 4L19 6',
  chevron: 'm9 5 7 7-7 7',
  down: 'm6 9 6 6 6-6',
  up: 'm6 15 6-6 6 6',
  left: 'm15 5-7 7 7 7',
  filter: 'M4 7h16M7 12h10m-7 5h4',
  pin: 'M18 10c0 5-6 10-6 10s-6-5-6-10a6 6 0 1 1 12 0Zm-4 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  ticket: 'M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V7Zm9 0v2m0 2v2m0 2v2',
  save: 'M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8',
  copy: 'M8 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v3M10 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  noMusic: 'M9 18V5l10-2v11M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm10-4a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM3 3l18 18',
  sidebar: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm4 0v16',
  close: 'm6 6 12 12M18 6 6 18',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 4.5V11m0-3.5h.01',
  settings: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2m0 13v2m9-8h-2m-14 0H3m15.36-6.36-1.42 1.42M7.06 16.94l-1.42 1.42m12.72 0-1.42-1.42M7.06 7.06 5.64 5.64',
} as const;

type IconName = keyof typeof paths;

export function Icon({ name, size = 17 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

const navigation = [
  { label: 'Catalogue', items: [
    { path: '/artists.html', name: 'Artists', icon: 'library' },
    { path: '/artists-to-confirm.html', name: 'Artists to confirm', icon: 'check' },
  ] },
  { label: 'Event sources', items: [
    { path: '/all-events.html', name: 'All', icon: 'calendar' },
    { path: '/needs-attention.html', name: 'Needs attention', icon: 'filter' },
    { path: '/saved-events.html', name: 'Saved', icon: 'save' },
    { path: '/not-music.html', name: 'Other events', icon: 'noMusic' },
    { path: '/avilys.html', name: 'Avilys', icon: 'avilys' },
    { path: '/vilnius-events.html', name: 'Vilnius Events', icon: 'pin' },
    { path: '/possible-duplicates.html', name: 'Possible duplicates', icon: 'search' },
  ] },
  { label: 'Tools', items: [
    { path: '/ai-evaluation.html', name: 'AI evaluation', icon: 'spark' },
    { path: '/ai-rules.html', name: 'AI rules', icon: 'settings' },
    { path: '/ai-usage.html', name: 'AI usage', icon: 'clock' },
  ] },
  { label: 'Preferences', items: [
    { path: '/settings.html', name: 'Settings', icon: 'settings' },
  ] },
] as const;

const collapsedKey = 'seeker.sidebar-collapsed';
function readCollapsed() {
  try { return window.localStorage.getItem(collapsedKey) === '1'; } catch { return false; }
}

export function Workspace({ children }: { children: ReactNode }) {
  const [attentionCount, setAttentionCount] = useState(0);
  // Desktop only: the phone layout uses the menu button instead.
  const [collapsed, setCollapsed] = useState(readCollapsed);
  function toggleCollapsed() {
    setCollapsed(value => {
      try { window.localStorage.setItem(collapsedKey, value ? '0' : '1'); } catch { /* The choice lasts for this page only. */ }
      return !value;
    });
  }
  useEffect(() => {
    let disposed = false;
    const load = () => { void api<{ count: number }>('/api/workflow/attention-count').then(result => {
      if (!disposed) setAttentionCount(result.count);
    }).catch(() => undefined); };
    load();
    window.addEventListener('seeker:attention-changed', load);
    const timer = window.setInterval(() => { if (!document.hidden) load(); }, 15000);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener('seeker:attention-changed', load); };
  }, []);
  const path = window.location.pathname === '/artist.html' ? '/artists.html' : window.location.pathname === '/event.html' ? '/all-events.html' : window.location.pathname;
  const current = navigation.flatMap(group => [...group.items]).find(item => item.path === path);
  const hosted = document.body.hasAttribute('data-hosted');
  const [menuOpen, setMenuOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !sidebar.current?.contains(event.target)) setMenuOpen(false);
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButton.current?.focus();
    }
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [menuOpen]);

  const signOut = hosted && <form action="/auth/logout" method="post">
    <button type="submit" className="secondary-button">Sign out</button>
  </form>;

  return (
    <div className="workspace" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
      <a className="skip-link" href="#content">Skip to content</a>
      <header className="sidebar" ref={sidebar}>
        <div className="sidebar-heading">
          <a className="brand" href="/" aria-label="Seeker home">
            <span className="brand-logo"><img src={logo} alt="" /></span>
            <span className="brand-text"><strong>Seeker</strong><small className="brand-workspace">Dracula workspace</small><small className="brand-page">{current?.name ?? 'Artists'}</small></span>
          </a>
          <button type="button" className="sidebar-toggle" aria-expanded={!collapsed} aria-controls="seeker-navigation"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggleCollapsed}>
            <Icon name="sidebar" size={17} />
          </button>
          <button type="button" className="secondary-button mobile-menu-toggle" aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen} aria-controls="seeker-navigation" ref={menuButton} onClick={() => setMenuOpen(open => !open)}>
            <Icon name={menuOpen ? 'close' : 'menu'} size={22} />
          </button>
        </div>
        <div id="seeker-navigation" className="sidebar-navigation" data-open={menuOpen}>
          <nav aria-label="Main navigation">
            {navigation.map(group => (
              <div className="nav-group" key={group.label}>
                <p>{group.label}</p>
                {group.items.map(item => (
                  <a className="nav-link" key={item.path} href={item.path} aria-current={item === current ? 'page' : undefined} onClick={() => setMenuOpen(false)}
                    title={collapsed ? item.name : undefined}>
                    <Icon name={item.icon} /> <span className="nav-label">{item.name}</span>{item.path === '/needs-attention.html' && attentionCount > 0 && <span className="nav-attention-count" aria-label={`${attentionCount} need attention`}>{attentionCount}</span>}
                  </a>
                ))}
              </div>
            ))}
          </nav>
          {hosted && <div className="mobile-sign-out">{signOut}</div>}
        </div>
        <div className="sidebar-footer" title={collapsed ? (hosted ? 'Online workspace' : 'Local workspace') : undefined}><span className="local-dot" /><span className="nav-label">{hosted ? 'Online workspace' : 'Local workspace'}</span></div>
      </header>
      <main className="main-content" id="content" tabIndex={-1}>
        <header className="topbar">
          <a href="/">Seeker</a><Icon name="chevron" size={13} /><strong>{current?.name ?? 'Artists'}</strong>
          {signOut}
        </header>
        <div className="page-wrap">{children}</div>
      </main>
    </div>
  );
}

export function PageHeading({ title, description, icon, href, linkLabel, tools, actions }: {
  title: string; description: string; icon: IconName; href?: string; linkLabel?: string; tools?: boolean; actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div className="heading-copy">
        <div className="heading-icon"><Icon name={icon} size={22} /></div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {(href || tools || actions) && <div className="heading-actions">
        {actions}
        {tools && <a className="secondary-button mobile-import-link" href="#import-tools"><Icon name="download" size={15} /> Import tools</a>}
        {href && <a className="secondary-button source-link" href={href} target="_blank" rel="noreferrer">{linkLabel} <Icon name="external" size={15} /></a>}
      </div>}
    </header>
  );
}

export function Metrics({ items }: { items: { label: string; value: ReactNode; icon: IconName }[] }) {
  return (
    <section className="metrics" aria-label="Overview">
      {items.map(item => (
        <div className="metric" key={item.label}>
          <span className="metric-icon"><Icon name={item.icon} /></span>
          <div><span className="metric-label">{item.label}</span><strong>{item.value}</strong></div>
        </div>
      ))}
    </section>
  );
}

export function PanelHeading({ title, description, icon, end }: { title: string; description?: string; icon?: IconName; end?: ReactNode }) {
  return (
    <header className="panel-heading">
      <div className="panel-title">
        {icon && <span className="panel-icon"><Icon name={icon} /></span>}
        <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
      </div>
      {end}
    </header>
  );
}

export function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="search-field">
      <Icon name="search" />
      <input type="search" aria-label={label} placeholder={label + '…'} value={value} onChange={event => onChange(event.target.value)} />
    </label>
  );
}

export function Pagination({ page, total, size, onChange }: { page: number; total: number; size: number; onChange: (page: number) => void }) {
  const lastPage = Math.max(1, Math.ceil(total / size));
  return (
    <nav className="pagination" aria-label="Pagination">
      <span>{total ? Math.min((page - 1) * size + 1, total) : 0}–{Math.min(page * size, total)} of {total.toLocaleString()}</span>
      <div>
        <button className="secondary-button" type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}><Icon name="left" size={14} /> Previous</button>
        <button className="secondary-button" type="button" disabled={page >= lastPage} onClick={() => onChange(page + 1)}>Next <Icon name="chevron" size={14} /></button>
      </div>
    </nav>
  );
}

export function Disclosure({ title, children, className = '', id }: { title: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <details className={`disclosure ${className}`} id={id} open={id && window.location.hash === `#${id}` ? true : undefined}>
      <summary>{title}<Icon name="down" size={15} /></summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

export function Feedback({ message, error = false }: { message: string; error?: boolean }) {
  return <div className={`feedback ${error ? 'feedback-error' : ''}`} role={error ? 'alert' : 'status'}>{message}</div>;
}
