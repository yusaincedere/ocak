// The chat's emoji picker: a short hand-picked set, not all of Unicode, so it stays quick to scan
// mid-game. Nothing newer than Emoji 13, and no flags (Windows doesn't draw those).
import type { MessageKey } from './i18n';

export const EMOJI_GROUPS: { label: MessageKey; emojis: string[] }[] = [
  {
    label: 'emoji.faces',
    emojis: ['😀', '😂', '🤣', '😅', '😊', '😇', '🙃', '😍', '😘', '😎', '🥳', '🤔', '🙄', '😏', '😬', '😐', '😴', '🥲', '😭', '😢', '😤', '😡', '🤬', '😱', '🥶', '🥵', '🤯', '🤐', '🤮', '🤡', '💀', '👻', '🤖', '👀'],
  },
  {
    label: 'emoji.hands',
    emojis: ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '👋', '👏', '🙌', '🙏', '💪', '🤝', '👊'],
  },
  {
    label: 'emoji.game',
    emojis: ['🎮', '🏆', '🥇', '🎯', '⚔️', '🛡️', '🏹', '🗡️', '🔥', '💥', '⚡', '❄️', '🌊', '🌪️', '🐉', '🐺', '👑', '💎', '💰', '🧠', '🩸', '🏃', '🚀', '🐢', '🐌', '💣'],
  },
  {
    label: 'emoji.symbols',
    emojis: ['❤️', '💔', '💯', '✅', '❌', '⚠️', '❓', '❗', '💤', '🎉', '✨', '⭐', '💩', '🍀', '🍺', '☕'],
  },
];

export const MAX_RECENT_EMOJI = 16;

/** Most recent first, each emoji once. */
export function pushRecentEmoji(recent: string[], emoji: string): string[] {
  return [emoji, ...recent.filter((e) => e !== emoji)].slice(0, MAX_RECENT_EMOJI);
}
