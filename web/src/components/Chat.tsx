// In-call chat: text and images, only between the people in the call. Nothing is stored on the
// server: text goes over LiveKit's chat, images as LiveKit byte streams straight to the others,
// and both are gone when the call ends. The panel is also what private chats show in
// (see PrivateChat.tsx).
import { useChat, useRoomContext } from '@livekit/components-react';
import type { ByteStreamReader, Participant, Room } from 'livekit-client';
import { createPortal } from 'react-dom';
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { translate, useT } from '../i18n';
import { useNarrow } from '../narrow';
import { colorFor } from '../presence';
import { sounds } from '../sounds';
import { useStore } from '../store';
import { IconButton } from './VoiceControls';
import { EmojiTray } from './EmojiTray';
import { Chat, ChevronDown, ChevronUp, Lock, Picture, Send, Smile, X } from './Icons';

export const IMAGE_TOPIC = 'ocak-image';
const ROULETTE_TOPIC = 'ocak-roulette';
/** Only plain image formats (no SVG: it can carry scripts). */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_SEND_BYTES = 8 * 1024 * 1024;
const MAX_RECEIVE_BYTES = 10 * 1024 * 1024;
/** Bigger photos are scaled down to this before sending (a phone photo is ~4000px). */
const MAX_SIDE = 2048;
/** Images kept in memory per call; older ones are let go. */
const KEEP_IMAGES = 60;
const MAX_FILES_AT_ONCE = 6;
/** With nothing going on the group chat's frame fades away; lines stay a little longer. */
const QUIET_AFTER_MS = 6_000;
const LINE_VISIBLE_MS = 14_000;

export interface ChatItem {
  id: string;
  identity: string;
  /** null when we no longer know the participant object (they left before we saw them) */
  from: Participant | null;
  name: string;
  isLocal: boolean;
  timestamp: number;
  text?: string;
  roulette?: string;
  image?: { url: string | null; status: 'sending' | 'sent' | 'failed'; progress?: number };
  /** private chats: the device of the other person */
  thread?: string;
}

/** What a chat panel shows and sends: the group chat and every private chat provide this. */
export interface ChatThread {
  items: ChatItem[];
  sendText: (text: string) => Promise<void>;
  sendImage: (file: File) => Promise<void>;
  draft: string;
  setDraft: (text: string) => void;
  sending: boolean;
  sendFailed: boolean;
}

class ImageError extends Error {}

/** Trailing space and leading blank lines go; line breaks inside the message stay. */
export const tidyMessage = (text: string) => text.replace(/^\s*\n|\s+$/g, '');

/** Messages we keep ourselves. Picture URLs are let go as they age and when the call ends. */
export function useHeldItems() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const urls = useRef(new Set<string>());

  const add = useCallback((item: ChatItem) =>
    setItems((list) => {
      const next = [...list, item];
      // Let go of the oldest pictures so a long call doesn't keep growing in memory.
      const withUrl = next.filter((i) => i.image?.url);
      for (const old of withUrl.slice(0, Math.max(0, withUrl.length - KEEP_IMAGES))) {
        URL.revokeObjectURL(old.image!.url!);
        urls.current.delete(old.image!.url!);
        old.image = { ...old.image!, url: null };
      }
      return next;
    }), []);
  const updateImage = useCallback((id: string, patch: Partial<NonNullable<ChatItem['image']>>) =>
    setItems((list) => list.map((i) => (i.id === id ? { ...i, image: { ...i.image!, ...patch } } : i))), []);
  const urlFor = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urls.current.add(url);
    return url;
  }, []);

  // The call is over: free the pictures.
  useEffect(() => {
    const all = urls.current;
    return () => {
      for (const u of all) URL.revokeObjectURL(u);
      all.clear();
    };
  }, []);

  return { items, add, updateImage, urlFor };
}

export type HeldItems = ReturnType<typeof useHeldItems>;

/** A picture coming in from someone; null when it isn't one we accept. */
export async function readPicture(reader: ByteStreamReader): Promise<Blob | null> {
  const type = reader.info.mimeType;
  if (!IMAGE_TYPES.includes(type)) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of reader) {
    size += chunk.byteLength;
    if (size > MAX_RECEIVE_BYTES) return null;
    chunks.push(chunk);
  }
  return new Blob(chunks as BlobPart[], { type });
}

/** Sends a picture and shows it right away with its progress. */
export async function sendPicture(
  room: Room,
  held: HeldItems,
  file: File,
  target: { topic: string; destinationIdentities?: string[]; thread?: string },
) {
  let ready: File;
  try {
    ready = await prepareImage(file);
  } catch (err) {
    useStore.getState().setNotice(err instanceof ImageError ? err.message : translate('chat.imageFailed'));
    return;
  }
  const local = room.localParticipant;
  const id = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  held.add({
    id,
    identity: local.identity,
    from: local,
    name: local.name || local.identity,
    isLocal: true,
    timestamp: Date.now(),
    image: { url: held.urlFor(ready), status: 'sending', progress: 0 },
    thread: target.thread,
  });
  try {
    await local.sendFile(ready, {
      topic: target.topic,
      destinationIdentities: target.destinationIdentities,
      mimeType: ready.type,
      onProgress: (p) => held.updateImage(id, { progress: p }),
    });
    held.updateImage(id, { status: 'sent' });
  } catch {
    held.updateImage(id, { status: 'failed' });
    useStore.getState().setNotice(translate('chat.imageFailed'));
  }
}

/** Text and image messages of this call, oldest first, plus ways to send them. */
export function useCallChat(): ChatThread & { announceRoulette: (champion: string) => Promise<void> } {
  const chat = useChat();
  const room = useRoomContext();
  const held = useHeldItems();
  // Keep the draft and send state for the call, even while the panel is closed.
  const [draft, setDraft] = useState(() => useStore.getState().chatDraft);
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const sendingRef = useRef(false);
  const { add, urlFor } = held;

  // Pictures from the others.
  useEffect(() => {
    const receive = async (reader: ByteStreamReader, identity: string) => {
      const blob = await readPicture(reader);
      if (!blob) return;
      const from = room.getParticipantByIdentity(identity) ?? null;
      add({
        id: reader.info.id,
        identity,
        from,
        name: from?.name || identity,
        isLocal: false,
        timestamp: reader.info.timestamp || Date.now(),
        image: { url: urlFor(blob), status: 'sent' },
      });
    };
    room.registerByteStreamHandler(IMAGE_TOPIC, (reader, { identity }) => void receive(reader, identity).catch(() => {}));
    return () => room.unregisterByteStreamHandler(IMAGE_TOPIC);
  }, [room, add, urlFor]);

  useEffect(() => {
    room.registerTextStreamHandler(ROULETTE_TOPIC, (reader, { identity }) => {
      void reader.readAll().then((champion) => {
        if (!champion || champion.length > 100) return;
        const from = room.getParticipantByIdentity(identity) ?? null;
        add({ id: reader.info.id, identity, from, name: from?.name || identity,
          isLocal: false, timestamp: reader.info.timestamp || Date.now(), roulette: champion });
      }).catch(() => {});
    });
    return () => room.unregisterTextStreamHandler(ROULETTE_TOPIC);
  }, [room, add]);

  const items = useMemo(() => {
    const texts: ChatItem[] = chat.chatMessages.map((m) => ({
      id: m.id,
      identity: m.from?.identity ?? '',
      from: m.from ?? null,
      name: m.from?.name || m.from?.identity || '',
      isLocal: !!m.from?.isLocal,
      timestamp: m.timestamp,
      text: m.message,
    }));
    return [...texts, ...held.items].sort((a, b) => a.timestamp - b.timestamp);
  }, [chat.chatMessages, held.items]);

  const sendText = async (text: string) => {
    const message = tidyMessage(text);
    if (!message.trim() || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setSendFailed(false);
    try {
      await chat.send(message);
      setDraft((current) => {
        const next = current === text ? '' : current;
        useStore.getState().setChatDraft(next);
        return next;
      });
    } catch {
      setSendFailed(true);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const sendImage = (file: File) => sendPicture(room, held, file, { topic: IMAGE_TOPIC });

  const announceRoulette = async (champion: string) => {
    try {
      const sent = await room.localParticipant.sendText(champion, { topic: ROULETTE_TOPIC });
      const local = room.localParticipant;
      add({ id: sent.id, identity: local.identity, from: local, name: local.name || local.identity,
        isLocal: true, timestamp: Date.now(), roulette: champion });
    } catch {
      useStore.getState().setNotice(translate('roulette.announceFailed'));
    }
  };

  return { items, sendText, sendImage, announceRoulette, draft,
    setDraft: (text) => { setDraft(text); useStore.getState().setChatDraft(text); }, sending, sendFailed };
}

/** Checks the type and size; big photos are scaled down (GIFs are sent as they are, to keep the animation). */
async function prepareImage(file: File): Promise<File> {
  if (!IMAGE_TYPES.includes(file.type)) throw new ImageError(translate('chat.imageType'));
  if (file.type === 'image/gif') {
    if (file.size > MAX_SEND_BYTES) throw new ImageError(translate('chat.imageTooBig'));
    return file;
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 1.5 * 1024 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const encode = (type: string) => new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, 0.86));
    // WebP keeps transparency and is small; browsers that can't make it fall back to JPEG.
    let blob = await encode('image/webp');
    if (!blob || blob.type !== 'image/webp') blob = await encode('image/jpeg');
    if (!blob) throw new ImageError(translate('chat.imageFailed'));
    if (blob.size > MAX_SEND_BYTES) throw new ImageError(translate('chat.imageTooBig'));
    return new File([blob], file.name.replace(/\.\w+$/, '') + (blob.type === 'image/webp' ? '.webp' : '.jpg'), { type: blob.type });
  } finally {
    bitmap.close();
  }
}

/** The message sound: when the chat is closed, or open but you're looking at another window. */
export function useChatSound(items: ChatItem[], chatOpen: boolean) {
  const enabled = useStore((s) => s.chatSound);
  const last = useRef(items.length);
  useEffect(() => {
    if (items.length > last.current) {
      const fresh = items.slice(last.current);
      const fromOthers = fresh.some((i) => !i.isLocal);
      const away = !chatOpen || document.hidden || !document.hasFocus();
      if (enabled && fromOthers && away) sounds.message();
    }
    last.current = items.length;
  }, [items, chatOpen, enabled]);
}

// ---------- the panel ----------

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g;
function linkify(text: string): ReactNode[] {
  return text.split(URL_RE).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noreferrer noopener">
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

interface PanelProps {
  chat: ChatThread;
  title: string;
  collapsed: boolean;
  unread: number;
  onToggle: () => void;
  /** a private chat: shows the lock and the close button */
  onClose?: () => void;
  /** the private chat's color; the group chat keeps the default */
  accent?: string;
  /** why nothing can be sent right now (the other person left) */
  blocked?: string | null;
  emptyText?: string;
  /** the group chat: fades when nothing is going on, Enter opens it */
  quietWhenIdle?: boolean;
  /** clicking a name in the group chat opens a private chat */
  onName?: (item: ChatItem) => void;
  /** change this to move the cursor into the box */
  focusRequest?: number;
}

export function ChatPanel({ chat, title, collapsed, unread, onToggle, onClose, accent, blocked, emptyText, quietWhenIdle, onName, focusRequest }: PanelProps) {
  const text = chat.draft;
  const setText = chat.setDraft;
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const t = useT();
  const lang = useStore((s) => s.lang);
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-GB', { hour: '2-digit', minute: '2-digit' }), [lang]);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);

  const pinned = useRef(true);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  // Follow new content only while already at the bottom. Leave readers in place.
  const scrollDown = () => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  };
  const followLatest = () => {
    if (pinned.current) scrollDown();
  };
  useLayoutEffect(followLatest, [chat.items, collapsed]);
  useEffect(() => {
    const observer = new ResizeObserver(followLatest);
    if (list.current) observer.observe(list.current);
    return () => observer.disconnect();
  }, []);

  // The box grows with the text, up to six lines.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 6 * 20 + 18)}px`;
  }, [text, collapsed]);

  // Emojis go in where the cursor is. Touch screens keep the keyboard down while picking.
  const [picking, setPicking] = useState(false);
  const caret = useRef<number | null>(null);
  const addEmoji = (emoji: string) => {
    if (chat.sending) return;
    const start = input.current?.selectionStart ?? text.length;
    const end = input.current?.selectionEnd ?? text.length;
    caret.current = start + emoji.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    useStore.getState().addRecentEmoji(emoji);
  };
  useLayoutEffect(() => {
    if (caret.current === null) return;
    input.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
    if (!window.matchMedia('(pointer: coarse)').matches) input.current?.focus();
  }, [text]);
  const closeEmoji = () => {
    setPicking(false);
    input.current?.focus();
  };
  useEffect(() => {
    if (!picking) return;
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node)) setPicking(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [picking]);

  // Going quiet: the frame and the box fade out of the way of the game, new lines still show for
  // a moment. Anything in progress keeps it awake. Timed from when a line got here, not from its
  // timestamp, since that comes from the sender's clock.
  // In a narrow window the chat sits under the people rather than over them: nothing to get out of the way of.
  const canGoQuiet = quietWhenIdle && !useNarrow();
  const [hovered, setHovered] = useState(false);
  const [typing, setTyping] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const firstSeen = useRef(new Map<string, number>());
  const quietNow = useRef(false);
  for (const m of chat.items) if (!firstSeen.current.has(m.id)) firstSeen.current.set(m.id, Date.now());
  const awake = !canGoQuiet || collapsed || hovered || typing || picking || dragging || !!viewing || awayFromLatest || !!text.trim() || chat.sending || chat.sendFailed;
  useEffect(() => {
    if (awake) {
      quietNow.current = false;
      setQuiet(false);
      return;
    }
    const delay = quietNow.current ? 0 : QUIET_AFTER_MS;
    quietNow.current = false;
    const timer = setTimeout(() => {
      setNow(Date.now());
      setQuiet(true);
    }, delay);
    return () => clearTimeout(timer);
  }, [awake]);
  useEffect(() => {
    if (!quiet) return;
    const left = [...firstSeen.current.values()].map((at) => at + LINE_VISIBLE_MS - Date.now()).filter((ms) => ms > 0);
    if (!left.length) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(...left) + 20);
    return () => clearTimeout(timer);
  }, [quiet, now, chat.items]);

  const [focusAsked, setFocusAsked] = useState(0);
  useEffect(() => {
    if (focusAsked || focusRequest) input.current?.focus();
  }, [focusAsked, focusRequest]);
  const wake = () => {
    if (collapsed) onToggle();
    setFocusAsked((n) => n + 1);
  };

  // Enter opens the group chat, unless something else on screen wants that key.
  useEffect(() => {
    if (!quietWhenIdle) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || e.isComposing || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      if (document.activeElement?.closest('input, textarea, select, button, a, [contenteditable]')) return;
      if (document.querySelector('.modal-backdrop, .lightbox, .volume-menu, dialog[open], .control-bar')) return;
      e.preventDefault();
      wake();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const sendFiles = (files: Iterable<File>) => {
    const pics = [...files].filter((f) => f.type.startsWith('image/')).slice(0, MAX_FILES_AT_ONCE);
    if (blocked) return pics.length > 0;
    for (const f of pics) void chat.sendImage(f);
    return pics.length > 0;
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    setPicking(false);
    if (!blocked) await chat.sendText(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter makes a new line (and Enter while typing with an IME picks a word).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    } else if (e.key === 'Escape') {
      if (picking) return setPicking(false);
      quietNow.current = true;
      e.currentTarget.blur();
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    if (sendFiles(e.clipboardData.files)) e.preventDefault();
  };

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragging(false);
    if (!sendFiles(e.dataTransfer.files)) useStore.getState().setNotice(t('chat.imageType'));
  };

  const shownQuiet = quiet && !collapsed;
  const classes = ['chat-panel', 'chat-box', 'chat-widget'];
  if (collapsed) classes.push('collapsed');
  if (dragging) classes.push('dragging');
  if (shownQuiet) classes.push('quiet');
  if (onClose) classes.push('private');

  return (
    <aside
      ref={panel}
      aria-label={title}
      className={classes.join(' ')}
      style={accent ? ({ '--chat-accent': accent } as CSSProperties) : undefined}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <header className="chat-top">
        <button type="button" className="chat-toggle" aria-expanded={!collapsed} onClick={onToggle}
          aria-label={t(collapsed ? 'chat.expand' : 'chat.collapse')}>
          {onClose && <Lock size={13} />}
          <strong>{title}</strong>
          {collapsed && unread > 0 && <span className="chat-unread">{unread > 99 ? '99+' : unread}</span>}
          <span className="spacer" />
          {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {onClose && (
          <button type="button" className="chat-close" aria-label={t('private.close')} title={t('private.close')} onClick={onClose}>
            <X size={14} />
          </button>
        )}
      </header>

      <div className="chat-content" hidden={collapsed}>

      <div className="chat-log">
      <div className="chat-list" ref={list} onScroll={() => {
        const el = list.current;
        if (!el) return;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 48;
        setAwayFromLatest(!pinned.current);
      }}>
        {chat.items.length === 0 && <p className="chat-empty">{emptyText ?? t('chat.empty')}</p>}
        {chat.items.map((m) => {
          const stale = shownQuiet && now - (firstSeen.current.get(m.id) ?? 0) >= LINE_VISIBLE_MS;
          const name = m.isLocal ? t('common.you') : m.name || t('common.someone');
          return (
            <div
              key={m.id}
              className={`chat-line${stale ? ' stale' : ''}`}
              style={{ '--c': colorFor(m.identity || m.name) } as CSSProperties}
            >
              <time className="chat-time">{timeFmt.format(m.timestamp)}</time>{' '}
              {onName && !m.isLocal && m.identity ? (
                <button type="button" className="chat-name" title={t('private.open')} onClick={() => onName(m)}>{name}</button>
              ) : (
                <strong className="chat-name">{name}</strong>
              )}
              <span className="chat-name-end">{m.roulette ? ' ' : ': '}</span>
              {m.roulette ? (
                <span className="chat-roulette">🎲 {t('roulette.announcement', { champion: m.roulette })}</span>
              ) : m.image ? (
                <ChatImage image={m.image} onOpen={setViewing} onLoad={followLatest} />
              ) : (
                <span className="chat-text">{linkify(m.text ?? '')}</span>
              )}
            </div>
          );
        })}
      </div>
      {picking && !collapsed && !blocked && <EmojiTray onPick={addEmoji} onClose={closeEmoji} />}
      </div>

      {awayFromLatest && <button type="button" className="btn chat-latest" onClick={() => {
        pinned.current = true;
        scrollDown();
        setAwayFromLatest(false);
      }}>{t('chat.latest')}</button>}

      {chat.sendFailed && !blocked && <div className="chat-send-error" role="alert">
        <span>{t('chat.notSent')}</span>
        <button type="button" className="btn small-btn" disabled={!text.trim() || chat.sending} onClick={() => void chat.sendText(text)}>{t('chat.retry')}</button>
      </div>}

      {blocked && <div className="chat-send-error" role="status"><span>{blocked}</span></div>}

      {dragging && <div className="chat-drop">{t('chat.dropHere')}</div>}

      <form className={`chat-input${text.trim() ? ' has-text' : ''}`} onSubmit={send}>
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) sendFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <IconButton label={t('chat.attach')} disabled={!!blocked} onClick={() => fileInput.current?.click()}>
          <Picture size={17} />
        </IconButton>
        <textarea
          ref={input}
          className="field"
          rows={1}
          value={text}
          readOnly={chat.sending}
          disabled={!!blocked}
          aria-label={t('chat.placeholder')}
          aria-busy={chat.sending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          placeholder={t('chat.placeholder')}
        />
        <IconButton label={t('chat.emoji')} active={picking} disabled={!!blocked} onClick={() => setPicking((open) => !open)}>
          <Smile size={17} />
        </IconButton>
        <button type="submit" className="chat-send" aria-label={t(chat.sending ? 'chat.sending' : 'chat.send')} title={t(chat.sending ? 'chat.sending' : 'chat.send')} disabled={!text.trim() || chat.sending || !!blocked}>
          <Send size={16} />
        </button>
      </form>

      {shownQuiet && (
        <button type="button" className="chat-wake" aria-label={t('chat.expand')} onClick={wake}>
          <Chat size={14} />
          <kbd>Enter</kbd>
        </button>
      )}

      </div>

      {viewing && <Lightbox url={viewing} onClose={() => setViewing(null)} />}
    </aside>
  );
}

function ChatImage({ image, onOpen, onLoad }: { image: NonNullable<ChatItem['image']>; onOpen: (url: string) => void; onLoad: () => void }) {
  const t = useT();
  if (!image.url) return <span className="chat-gone">{t('chat.imageGone')}</span>;
  const url = image.url;
  return (
    <button type="button" className={`chat-image ${image.status}`} onClick={() => onOpen(url)} title={t('chat.openImage')}>
      <img src={url} alt="" onLoad={onLoad} draggable={false} />
      {image.status === 'sending' && (
        <span className="chat-image-progress">
          <span style={{ width: `${Math.round((image.progress ?? 0) * 100)}%` }} />
        </span>
      )}
      {image.status === 'failed' && <span className="chat-image-failed">{t('chat.imageFailed')}</span>}
    </button>
  );
}

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="lightbox" role="dialog" aria-label={t('chat.openImage')} onClick={onClose}>
      <img src={url} alt="" onClick={(e) => e.stopPropagation()} />
      <button type="button" className="icon-btn lightbox-close" aria-label={t('common.close')} onClick={onClose}>
        <X size={20} />
      </button>
    </div>,
    document.body,
  );
}
