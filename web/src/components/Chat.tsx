// In-call chat: text and images, only between the people in the call. Nothing is stored on the
// server: text goes over LiveKit's chat, images as LiveKit byte streams straight to the others,
// and both are gone when the call ends.
import { useChat, useRoomContext } from '@livekit/components-react';
import type { ByteStreamReader, Participant } from 'livekit-client';
import {
  Fragment,
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
import { avatarOf, colorFor, initials } from '../presence';
import { sounds } from '../sounds';
import { useStore } from '../store';
import { IconButton } from './VoiceControls';
import { Picture, Send, X } from './Icons';
import { AvatarPhoto } from './People';

export const IMAGE_TOPIC = 'ocak-image';
/** Only plain image formats (no SVG: it can carry scripts). */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_SEND_BYTES = 8 * 1024 * 1024;
const MAX_RECEIVE_BYTES = 10 * 1024 * 1024;
/** Bigger photos are scaled down to this before sending (a phone photo is ~4000px). */
const MAX_SIDE = 2048;
/** Images kept in memory per call; older ones are let go. */
const KEEP_IMAGES = 60;
const MAX_FILES_AT_ONCE = 6;

export interface ChatItem {
  id: string;
  identity: string;
  /** null when we no longer know the participant object (they left before we saw them) */
  from: Participant | null;
  name: string;
  isLocal: boolean;
  timestamp: number;
  text?: string;
  image?: { url: string | null; status: 'sending' | 'sent' | 'failed'; progress?: number };
}

export type CallChat = ReturnType<typeof useCallChat>;

class ImageError extends Error {}

/** Text and image messages of this call, oldest first, plus ways to send them. */
export function useCallChat() {
  const chat = useChat();
  const room = useRoomContext();
  const [images, setImages] = useState<ChatItem[]>([]);
  const urls = useRef(new Set<string>());

  const addImage = (item: ChatItem) =>
    setImages((list) => {
      const next = [...list, item];
      // Let go of the oldest pictures so a long call doesn't keep growing in memory.
      const withUrl = next.filter((i) => i.image?.url);
      for (const old of withUrl.slice(0, Math.max(0, withUrl.length - KEEP_IMAGES))) {
        URL.revokeObjectURL(old.image!.url!);
        urls.current.delete(old.image!.url!);
        old.image = { ...old.image!, url: null };
      }
      return next;
    });
  const updateImage = (id: string, patch: Partial<NonNullable<ChatItem['image']>>) =>
    setImages((list) => list.map((i) => (i.id === id ? { ...i, image: { ...i.image!, ...patch } } : i)));

  // Pictures from the others.
  useEffect(() => {
    const receive = async (reader: ByteStreamReader, identity: string) => {
      const type = reader.info.mimeType;
      if (!IMAGE_TYPES.includes(type)) return;
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of reader) {
        size += chunk.byteLength;
        if (size > MAX_RECEIVE_BYTES) return;
        chunks.push(chunk);
      }
      const from = room.getParticipantByIdentity(identity) ?? null;
      const url = URL.createObjectURL(new Blob(chunks as BlobPart[], { type }));
      urls.current.add(url);
      addImage({
        id: reader.info.id,
        identity,
        from,
        name: from?.name || identity,
        isLocal: false,
        timestamp: reader.info.timestamp || Date.now(),
        image: { url, status: 'sent' },
      });
    };
    room.registerByteStreamHandler(IMAGE_TOPIC, (reader, { identity }) => void receive(reader, identity).catch(() => {}));
    return () => room.unregisterByteStreamHandler(IMAGE_TOPIC);
  }, [room]);

  // The call is over: free the pictures.
  useEffect(() => {
    const all = urls.current;
    return () => {
      for (const u of all) URL.revokeObjectURL(u);
      all.clear();
    };
  }, []);

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
    return [...texts, ...images].sort((a, b) => a.timestamp - b.timestamp);
  }, [chat.chatMessages, images]);

  const sendText = (text: string) => chat.send(text);

  const sendImage = async (file: File) => {
    let ready: File;
    try {
      ready = await prepareImage(file);
    } catch (err) {
      useStore.getState().setNotice(err instanceof ImageError ? err.message : translate('chat.imageFailed'));
      return;
    }
    const local = room.localParticipant;
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const url = URL.createObjectURL(ready);
    urls.current.add(url);
    addImage({
      id,
      identity: local.identity,
      from: local,
      name: local.name || local.identity,
      isLocal: true,
      timestamp: Date.now(),
      image: { url, status: 'sending', progress: 0 },
    });
    try {
      await local.sendFile(ready, {
        topic: IMAGE_TOPIC,
        mimeType: ready.type,
        onProgress: (p) => updateImage(id, { progress: p }),
      });
      updateImage(id, { status: 'sent' });
    } catch {
      updateImage(id, { status: 'failed' });
      useStore.getState().setNotice(translate('chat.imageFailed'));
    }
  };

  return { items, sendText, sendImage };
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

/** Messages in a row from the same person (within two minutes) share one avatar and name. */
function groupsOf(items: ChatItem[]) {
  const groups: { key: string; first: ChatItem; items: ChatItem[] }[] = [];
  for (const item of items) {
    const g = groups[groups.length - 1];
    const prev = g?.items[g.items.length - 1];
    if (g && prev && prev.identity === item.identity && item.timestamp - prev.timestamp < 120_000) g.items.push(item);
    else groups.push({ key: item.id, first: item, items: [item] });
  }
  return groups;
}

export function ChatPanel({ chat, onClose }: { chat: CallChat; onClose: () => void }) {
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const t = useT();
  const lang = useStore((s) => s.lang);
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-GB', { hour: '2-digit', minute: '2-digit' }), [lang]);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => groupsOf(chat.items), [chat.items]);

  // Stay at the bottom as messages (and pictures, once loaded) come in.
  const scrollDown = () => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  };
  useLayoutEffect(scrollDown, [chat.items.length]);

  // The box grows with the text, up to six lines.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 6 * 20 + 18)}px`;
  }, [text]);

  const sendFiles = (files: Iterable<File>) => {
    const pics = [...files].filter((f) => f.type.startsWith('image/')).slice(0, MAX_FILES_AT_ONCE);
    for (const f of pics) void chat.sendImage(f);
    return pics.length > 0;
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const msg = text.replace(/^\s*\n|\s+$/g, '');
    if (!msg.trim()) return;
    setText('');
    try {
      await chat.sendText(msg);
    } catch {
      useStore.getState().setNotice(t('chat.notSent'));
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter makes a new line (and Enter while typing with an IME picks a word).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
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

  return (
    <aside className={`chat-panel chat-box${dragging ? ' dragging' : ''}`} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <header className="chat-top">
        <div className="chat-title">
          <strong>{t('chat.title')}</strong>
          <span>{t('chat.subtitle')}</span>
        </div>
        <div className="spacer" />
        <IconButton label={t('chat.close')} onClick={onClose}>
          <X size={16} />
        </IconButton>
      </header>

      <div className="chat-list" ref={list}>
        {groups.length === 0 && <p className="chat-empty">{t('chat.empty')}</p>}
        {groups.map((g) => (
          <div
            key={g.key}
            className={`chat-group${g.first.isLocal ? ' mine' : ''}`}
            style={{ '--c': colorFor(g.first.identity || g.first.name) } as CSSProperties}
          >
            <ChatAvatar item={g.first} />
            <div className="chat-group-body">
              <div className="chat-head">
                <strong>{g.first.isLocal ? t('common.you') : g.first.name || t('common.someone')}</strong>
                <span className="chat-time">{timeFmt.format(g.first.timestamp)}</span>
              </div>
              {g.items.map((m) =>
                m.image ? (
                  <ChatImage key={m.id} image={m.image} onOpen={setViewing} onLoad={scrollDown} />
                ) : (
                  <div key={m.id} className="chat-bubble">
                    {linkify(m.text ?? '')}
                  </div>
                ),
              )}
            </div>
          </div>
        ))}
      </div>

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
        <IconButton label={t('chat.attach')} onClick={() => fileInput.current?.click()}>
          <Picture size={17} />
        </IconButton>
        <textarea
          ref={input}
          className="field"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={t('chat.placeholder')}
          autoFocus
        />
        <button type="submit" className="chat-send" aria-label={t('chat.send')} title={t('chat.send')} disabled={!text.trim()}>
          <Send size={16} />
        </button>
      </form>

      {viewing && <Lightbox url={viewing} onClose={() => setViewing(null)} />}
    </aside>
  );
}

function ChatAvatar({ item }: { item: ChatItem }) {
  const myAvatar = useStore((s) => s.avatar);
  const pick = item.isLocal ? myAvatar : item.from ? avatarOf(item.from) : null;
  return (
    <div className="chat-avatar" aria-hidden>
      <span className="avatar-initials">{initials(item.name || '?')}</span>
      {pick && <AvatarPhoto key={pick.src} pick={pick} />}
    </div>
  );
}

function ChatImage({ image, onOpen, onLoad }: { image: NonNullable<ChatItem['image']>; onOpen: (url: string) => void; onLoad: () => void }) {
  const t = useT();
  if (!image.url) return <div className="chat-bubble muted small">{t('chat.imageGone')}</div>;
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
  return (
    <div className="lightbox" role="dialog" aria-label={t('chat.openImage')} onClick={onClose}>
      <img src={url} alt="" onClick={(e) => e.stopPropagation()} />
      <button type="button" className="icon-btn lightbox-close" aria-label={t('common.close')} onClick={onClose}>
        <X size={20} />
      </button>
    </div>
  );
}
