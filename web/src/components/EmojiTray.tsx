import { useState } from 'react';
import { EMOJI_GROUPS } from '../emoji';
import { useT } from '../i18n';
import { useStore } from '../store';

/** Covers the messages while open. Stays open so several can be picked in a row. */
export function EmojiTray({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const t = useT();
  // Taken once: the row must not shuffle under the mouse while you're picking.
  const [recent] = useState(() => useStore.getState().recentEmoji);
  const groups = [
    ...(recent.length ? [{ label: t('emoji.recent'), emojis: recent }] : []),
    ...EMOJI_GROUPS.map((group) => ({ label: t(group.label), emojis: group.emojis })),
  ];
  return (
    <div className="chat-emoji" role="group" aria-label={t('chat.emoji')} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      {groups.map((group) => (
        <section key={group.label}>
          <h3>{group.label}</h3>
          <div className="chat-emoji-grid">
            {group.emojis.map((emoji) => (
              <button key={emoji} type="button" onClick={() => onPick(emoji)}>{emoji}</button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
