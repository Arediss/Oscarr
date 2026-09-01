import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, Trash2, Bell, Eye, Reply, Shield } from 'lucide-react';
import { clsx } from 'clsx';
import { useNotifications, type UserNotification } from '@/hooks/useNotifications';
import type { TFunction } from 'i18next';

function timeAgo(dateStr: string, t: (key: string) => string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t('notifications.just_now');
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface TypeVisual {
  icon: string;
  color: string;
  bg: string;
}

const TYPE_VISUALS: Record<string, TypeVisual> = {
  request_approved: { icon: '✓', color: 'text-green-400', bg: 'bg-green-500/10' },
  request_declined: { icon: '✗', color: 'text-red-400', bg: 'bg-red-500/10' },
  request_pending_review: { icon: '⏳', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  media_available: { icon: '▶', color: 'text-ndp-accent', bg: 'bg-ndp-accent/10' },
  support_reply: { icon: '💬', color: 'text-blue-400', bg: 'bg-blue-500/10' },
};

function groupKey(dateStr: string): 'today' | 'week' | 'older' {
  const d = new Date(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'today';
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 7 * 86_400_000) return 'week';
  return 'older';
}

interface NotifAction {
  href: string;
  labelKey: string;
  fallback: string;
  icon: 'eye' | 'reply' | 'shield';
}

function getNotifAction(notif: UserNotification): NotifAction | null {
  const md = (notif.metadata ?? {}) as Record<string, unknown>;
  if (notif.type === 'request_pending_review') {
    return { href: '/admin?tab=requests', labelKey: 'notifications.action.review', fallback: 'Gérer', icon: 'shield' };
  }
  if (notif.type === 'request_approved' || notif.type === 'request_declined' || notif.type === 'media_available') {
    const tmdbId = md.tmdbId;
    const mediaType = md.mediaType;
    if (typeof tmdbId === 'number' && (mediaType === 'movie' || mediaType === 'tv')) {
      return { href: `/${mediaType}/${tmdbId}`, labelKey: 'notifications.action.view', fallback: 'Voir', icon: 'eye' };
    }
  }
  if (notif.type === 'support_reply') {
    // Support module shipped as a plugin since 0.8 — Oscarr-Plugin-Support owns this notif
    // type via ctx.sendUserNotification. Route stays generic on the plugin's `/p/<id>` URL.
    return { href: '/p/arediss__oscarr-plugin-support', labelKey: 'notifications.action.reply', fallback: 'Répondre', icon: 'reply' };
  }
  return null;
}

interface NotificationListProps {
  /** When true, per-item actions are always visible (touch-friendly). Default reveals on hover. */
  actionsAlwaysVisible?: boolean;
  /** Called after the user follows an inline action — lets the parent close its dropdown/drawer. */
  onAction?: () => void;
}

export default function NotificationList({ actionsAlwaysVisible = false, onAction }: Readonly<NotificationListProps>) {
  const { t } = useTranslation();
  const { notifications, markAsRead, dismiss } = useNotifications();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const unreadCount = notifications.filter((n) => !n.read).length;
  const filtered = filter === 'unread' ? notifications.filter((n) => !n.read) : notifications;

  const groups = useMemo(() => {
    const out: Record<'today' | 'week' | 'older', UserNotification[]> = { today: [], week: [], older: [] };
    for (const n of filtered) out[groupKey(n.createdAt)].push(n);
    return out;
  }, [filtered]);

  const sharedCardProps = { t, markAsRead, dismiss, onAction, actionsAlwaysVisible };

  return (
    <div>
      <div className="px-3 pt-2 pb-2 flex items-center gap-1 border-b border-white/5">
        <FilterTab label={t('notifications.tabs.all', 'Toutes')} active={filter === 'all'} onClick={() => setFilter('all')} />
        <FilterTab
          label={t('notifications.tabs.unread', 'Non lues')}
          active={filter === 'unread'}
          onClick={() => setFilter('unread')}
          badge={unreadCount}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState filter={filter} t={t} />
      ) : (
        <>
          <Group label={t('notifications.group.today', "Aujourd'hui")} notifs={groups.today} {...sharedCardProps} />
          <Group label={t('notifications.group.week', 'Cette semaine')} notifs={groups.week} {...sharedCardProps} />
          <Group label={t('notifications.group.older', 'Plus ancien')} notifs={groups.older} {...sharedCardProps} />
        </>
      )}
    </div>
  );
}

function FilterTab({ label, active, onClick, badge }: Readonly<{ label: string; active: boolean; onClick: () => void; badge?: number }>) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
        active ? 'bg-white/10 text-ndp-text' : 'text-ndp-text-dim hover:text-ndp-text hover:bg-white/5',
      )}
    >
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="text-[10px] min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-ndp-accent text-white font-bold">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

interface GroupProps {
  label: string;
  notifs: UserNotification[];
  t: TFunction;
  markAsRead: (id: number) => Promise<void>;
  dismiss: (id: number) => Promise<void>;
  onAction?: () => void;
  actionsAlwaysVisible: boolean;
}

function Group({ label, notifs, ...rest }: Readonly<GroupProps>) {
  if (notifs.length === 0) return null;
  return (
    <div>
      <p className="px-4 pt-3 pb-1.5 text-[10px] uppercase tracking-wider font-semibold text-ndp-text-dim bg-white/[0.015]">
        {label}
      </p>
      {notifs.map((n) => <NotifCard key={n.id} notif={n} {...rest} />)}
    </div>
  );
}

interface NotifCardProps {
  notif: UserNotification;
  t: TFunction;
  markAsRead: (id: number) => Promise<void>;
  dismiss: (id: number) => Promise<void>;
  onAction?: () => void;
  actionsAlwaysVisible: boolean;
}

function NotifCard({ notif, t, markAsRead, dismiss, onAction, actionsAlwaysVisible }: Readonly<NotifCardProps>) {
  const navigate = useNavigate();
  const visual = TYPE_VISUALS[notif.type] ?? { icon: '•', color: 'text-ndp-text-muted', bg: 'bg-white/5' };
  const action = getNotifAction(notif);
  const isUnread = !notif.read;

  const titleText = notif.title?.startsWith('notifications.msg.')
    ? t(notif.title, (notif.metadata?.msgParams as Record<string, unknown>) || {})
    : notif.title;
  const messageText = notif.message?.startsWith('notifications.msg.')
    ? t(notif.message, (notif.metadata?.msgParams as Record<string, unknown>) || {})
    : notif.message;

  const handleClick = () => { if (isUnread) markAsRead(notif.id); };

  const handleAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!action) return;
    if (isUnread) markAsRead(notif.id);
    navigate(action.href);
    onAction?.();
  };

  const ActionIcon = action?.icon === 'reply' ? Reply : action?.icon === 'shield' ? Shield : Eye;

  return (
    // The card used to be role="button" with three more buttons inside it. Nesting interactive
    // controls is invalid: a screen reader announces one button and swallows the others, and the
    // outer keydown handler competed with the inner ones. The row is a plain container now, with
    // a single overlay button carrying the card action and the real buttons stacked above it.
    <div
      className={clsx(
        'group relative flex gap-3 px-4 py-3 hover:bg-white/[0.04] transition-colors border-b border-white/5 last:border-0',
        isUnread && 'bg-ndp-accent/[0.04]',
      )}
    >
      <button
        type="button"
        onClick={handleClick}
        aria-label={titleText}
        className="absolute inset-0 z-0 cursor-pointer rounded-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ndp-accent"
      />
      {isUnread && <span className="absolute left-0 top-3 bottom-3 w-0.5 bg-ndp-accent rounded-r" />}

      <div className={clsx('w-9 h-9 rounded-full flex items-center justify-center text-base flex-shrink-0', visual.bg, visual.color)}>
        {visual.icon}
      </div>

      <div className="pointer-events-none relative z-10 flex-1 min-w-0">
        <p className={clsx('text-sm leading-snug truncate', isUnread ? 'text-ndp-text font-semibold' : 'text-ndp-text-muted')}>
          {titleText}
        </p>
        {messageText && (
          <p className="text-xs text-ndp-text-dim mt-0.5 line-clamp-2">{messageText}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[10px] text-ndp-text-dim">{timeAgo(notif.createdAt, t)}</span>
          {action && (
            <button
              onClick={handleAction}
              className="pointer-events-auto relative z-10 flex items-center gap-1 text-[11px] font-medium text-ndp-accent hover:text-ndp-accent/80 transition-colors"
            >
              <ActionIcon className="w-3 h-3" />
              {t(action.labelKey, action.fallback)}
            </button>
          )}
        </div>
      </div>

      <div className={clsx(
        'flex items-start gap-0.5 transition-opacity flex-shrink-0',
        actionsAlwaysVisible ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
      )}>
        {isUnread && (
          <button
            onClick={(e) => { e.stopPropagation(); markAsRead(notif.id); }}
            className="relative z-10 p-1 text-ndp-text-dim hover:text-ndp-accent rounded hover:bg-white/5"
            title={t('notifications.mark_read')}
            aria-label={t('notifications.mark_read')}
          >
            <Check className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); dismiss(notif.id); }}
          className="relative z-10 p-1 text-ndp-text-dim hover:text-ndp-danger rounded hover:bg-white/5"
          title={t('notifications.dismiss')}
          aria-label={t('notifications.dismiss')}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function EmptyState({ filter, t }: Readonly<{ filter: 'all' | 'unread'; t: TFunction }>) {
  return (
    <div className="px-4 py-10 text-center">
      <Bell className="w-8 h-8 text-ndp-text-dim/40 mx-auto mb-3" />
      <p className="text-sm text-ndp-text-dim">
        {filter === 'unread'
          ? t('notifications.empty.unread', 'Tu es à jour ✨')
          : t('notifications.no_notifications', 'Aucune notification')}
      </p>
    </div>
  );
}
