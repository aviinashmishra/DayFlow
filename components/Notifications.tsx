'use client';
import { toast } from '@/lib/client/bus';
import { relTime } from '@/lib/client/util';
import type { AppNotification, NotificationKind } from '@/lib/types';
import { useDayflow, useStore, useUI } from './ctx';
import { Icon } from './Icons';
import { Sheet } from './Overlays';

const KIND_ICON: Record<NotificationKind, string> = {
  assigned: 'i-user-plus',
  review: 's3',
  comment: 'i-comment',
  mention: 'i-at',
  blocked: 's2',
  status: 's1',
  team: 'i-users'
};

export function BellButton() {
  const s = useDayflow();
  const ui = useUI();
  const n = s.unread;
  return (
    <button className="icon-btn bell" id="bellBtn" aria-label={n ? `Notifications, ${n} unread` : 'Notifications'} onClick={ui.openNotifications}>
      <Icon name="i-bell" />
      {n > 0 && <span className="bell-badge" aria-hidden="true">{n > 99 ? '99+' : n}</span>}
    </button>
  );
}

export function NotificationsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useDayflow();
  const store = useStore();
  const ui = useUI();

  const go = (n: AppNotification) => {
    if (!n.read) void store.markRead([n.id]);
    if (n.taskId) {
      if (s.tasks.some((t) => t.id === n.taskId)) { onClose(); ui.openDetail(n.taskId); }
      else toast('That task is no longer on the board (done and cleared, or deleted).', { icon: 'i-board' });
    } else if (n.kind === 'team') {
      onClose();
      ui.openOrg('teams');
    }
  };

  const head = (
    <>
      <h2 id="notifTitle">Notifications</h2>
      <div className="row-gap">
        {s.unread > 0 && <button className="link-btn" onClick={() => void store.markRead()}>Mark all read</button>}
        <button className="icon-btn" data-close aria-label="Close" onClick={onClose}><Icon name="i-x" /></button>
      </div>
    </>
  );

  return (
    <Sheet open={open} onClose={onClose} labelledBy="notifTitle" head={head}>
      {s.notifications.length === 0 ? (
        <div className="notif-empty">
          <span className="empty-art" aria-hidden="true"><Icon name="i-bell" /></span>
          <p><b>You are all caught up.</b></p>
          <p className="muted">You will hear here when someone assigns you work, asks for a review, mentions you, or a task in your team gets blocked.</p>
        </div>
      ) : (
        <ul className="notif-list">
          {s.notifications.map((n) => (
            <li key={n.id}>
              <button className={`notif${n.read ? '' : ' unread'}`} onClick={() => go(n)}>
                <span className={`notif-ico k-${n.kind}`}><Icon name={KIND_ICON[n.kind] ?? 'i-bell'} /></span>
                <span className="notif-body">
                  <span className="notif-text">{n.text}</span>
                  <time>{relTime(n.createdAt)}</time>
                </span>
                {!n.read && <i className="notif-dot" aria-label="Unread" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
