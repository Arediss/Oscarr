import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import { DynamicIcon } from './DynamicIcon';
import type { PluginUIContribution } from './types';

export function PluginNavItem({ contribution, mobile = false, onNavigate }: {
  contribution: PluginUIContribution; mobile?: boolean; onNavigate?: () => void;
}) {
  const location = useLocation();
  const { t } = useTranslation();
  const path = contribution.props.path as string;
  const label = contribution.props.label as string;
  const browseLabel = t('nav.browse_plugin', { defaultValue: 'Browse {{label}}', label });
  const items = (Array.isArray(contribution.props.items) ? contribution.props.items : [])
    .filter((item): item is { label: string; path: string } => !!item && typeof item.label === 'string' && typeof item.path === 'string' && item.path.startsWith(`${path}#/`)).slice(0, 20);
  const active = location.pathname.startsWith(path);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 64, left: 16 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);
  const id = useId();
  useEffect(() => setOpen(false), [location.pathname, location.hash]);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect) setPosition({ top: rect.bottom + 10, left: Math.max(12, Math.min(rect.right - 232, window.innerWidth - 244)) });
    };
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); }
    };
    place();
    menu.current?.querySelector('a')?.focus();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const links = items.map(item => (
    <Link key={item.path} to={item.path} onClick={() => { setOpen(false); onNavigate?.(); }}
      aria-current={active && `${location.pathname}${location.hash || '#/home'}` === item.path ? 'page' : undefined}
      className="block px-3 py-2.5 rounded-lg text-sm text-ndp-text-muted hover:text-white hover:bg-white/5 aria-[current=page]:text-ndp-accent aria-[current=page]:bg-ndp-accent/10">
      {item.label}
    </Link>
  ));
  return <div className={mobile ? '' : 'flex items-center flex-shrink-0'}>
    <Link to={path} onClick={onNavigate} aria-label={label} title={label}
      className={clsx('flex items-center rounded-lg text-sm font-medium transition-colors', mobile ? 'gap-3 px-3 py-2.5' : 'gap-1.5 px-3 py-1.5', active ? 'bg-ndp-accent/10 text-ndp-accent' : 'text-ndp-text-muted hover:text-ndp-text hover:bg-white/5')}>
      <DynamicIcon name={contribution.props.icon as string} className={mobile ? 'w-5 h-5 flex-shrink-0' : 'w-4 h-4 flex-shrink-0'} />
      <span className={mobile ? 'truncate' : 'oscarr-nav-label'}>{label}</span>
    </Link>
    {!mobile && items.length > 0 && <button ref={trigger} type="button" aria-label={browseLabel} aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(value => !value)} className="p-1.5 rounded-lg text-ndp-text-muted hover:bg-white/5 hover:text-white"><ChevronDown className="w-3.5 h-3.5" /></button>}
    {mobile && active && items.length > 0 && <div className="ml-8 mb-2 border-l border-white/10 pl-2">{links}</div>}
    {!mobile && open && createPortal(<nav ref={menu} id={id} aria-label={browseLabel} style={position}
      className="fixed z-[80] w-[232px] p-2 rounded-xl bg-ndp-surface border border-white/10 shadow-2xl shadow-black/40">{links}</nav>, document.body)}
  </div>;
}
