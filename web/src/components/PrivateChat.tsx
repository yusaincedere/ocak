// One-to-one chat inside a call. Messages are addressed to one person, so LiveKit only delivers
// them to that person; like the group chat nothing is stored and it's gone when the call ends.
import { useRoomContext } from '@livekit/components-react';
import type { ByteStreamReader, Participant } from 'livekit-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { colorFor, deviceOf } from '../presence';
import { sounds } from '../sounds';
import { useStore } from '../store';
import { closeThread, patchThread, receiveInThread, showThread, toggleThread, type Thread, type Threads } from '../threads';
import { readPicture, sendPicture, tidyMessage, useHeldItems, type ChatItem, type ChatThread } from './Chat';

const TEXT_TOPIC = 'ocak-private';
const IMAGE_TOPIC = 'ocak-private-image';

export interface PrivateChat extends Thread {
  chat: ChatThread;
  color: string;
  /** they're in the call right now, so there's someone to send to */
  online: boolean;
  /** changes when this one should take the cursor */
  focusRequest: number;
}

export function usePrivateChats(participants: Participant[]) {
  const room = useRoomContext();
  const held = useHeldItems();
  const { add, urlFor } = held;
  const [threads, setThreads] = useState<Threads>({});
  const [focus, setFocus] = useState<{ device: string; count: number }>({ device: '', count: 0 });
  const current = useRef(threads);
  current.current = threads;
  const sendingNow = useRef(new Set<string>());

  const update = useCallback((device: string, patch: (thread: Thread) => Partial<Thread>) => {
    setThreads((all) => patchThread(all, device, patch));
  }, []);

  /** Everyone on that device: the same person can be here from two tabs. */
  const identitiesOf = (device: string) =>
    [...room.remoteParticipants.values()].filter((p) => deviceOf(p.identity) === device).map((p) => p.identity);

  // Messages to us, in any conversation.
  useEffect(() => {
    const arrived = (identity: string, make: (from: Participant | null, name: string, device: string) => ChatItem) => {
      const from = room.getParticipantByIdentity(identity) ?? null;
      const name = from?.name || identity;
      const device = deviceOf(identity);
      const thread = current.current[device];
      const reading = !!thread?.open && !thread.collapsed;
      add(make(from, name, device));
      setThreads((all) => receiveInThread(all, device, name));
      if (useStore.getState().chatSound && (!reading || document.hidden || !document.hasFocus())) sounds.privateMessage();
    };
    const receivePicture = async (reader: ByteStreamReader, identity: string) => {
      const blob = await readPicture(reader);
      if (!blob) return;
      arrived(identity, (from, name, device) => ({
        id: reader.info.id,
        identity,
        from,
        name,
        isLocal: false,
        timestamp: reader.info.timestamp || Date.now(),
        image: { url: urlFor(blob), status: 'sent' },
        thread: device,
      }));
    };
    room.registerTextStreamHandler(TEXT_TOPIC, (reader, { identity }) => {
      void reader.readAll().then((text) => {
        if (!text.trim()) return;
        arrived(identity, (from, name, device) => ({
          id: reader.info.id,
          identity,
          from,
          name,
          isLocal: false,
          timestamp: reader.info.timestamp || Date.now(),
          text,
          thread: device,
        }));
      }).catch(() => {});
    });
    room.registerByteStreamHandler(IMAGE_TOPIC, (reader, { identity }) => void receivePicture(reader, identity).catch(() => {}));
    return () => {
      room.unregisterTextStreamHandler(TEXT_TOPIC);
      room.unregisterByteStreamHandler(IMAGE_TOPIC);
    };
  }, [room, add, urlFor]);

  const sendText = async (device: string, text: string) => {
    const message = tidyMessage(text);
    const to = identitiesOf(device);
    if (!message.trim() || !to.length || sendingNow.current.has(device)) return;
    sendingNow.current.add(device);
    update(device, () => ({ sending: true, failed: false }));
    try {
      const sent = await room.localParticipant.sendText(message, { topic: TEXT_TOPIC, destinationIdentities: to });
      const local = room.localParticipant;
      add({
        id: sent.id,
        identity: local.identity,
        from: local,
        name: local.name || local.identity,
        isLocal: true,
        timestamp: Date.now(),
        text: message,
        thread: device,
      });
      update(device, (thread) => ({ draft: thread.draft === text ? '' : thread.draft }));
    } catch {
      update(device, () => ({ failed: true }));
    } finally {
      sendingNow.current.delete(device);
      update(device, () => ({ sending: false }));
    }
  };

  const sendImage = async (device: string, file: File) => {
    const to = identitiesOf(device);
    if (to.length) await sendPicture(room, held, file, { topic: IMAGE_TOPIC, destinationIdentities: to, thread: device });
  };

  const open = useCallback((device: string, name: string) => {
    setThreads((all) => showThread(all, device, name));
    setFocus((f) => ({ device, count: f.count + 1 }));
  }, []);
  const toggle = (device: string) => {
    if (threads[device]?.collapsed) setFocus((f) => ({ device, count: f.count + 1 }));
    setThreads((all) => toggleThread(all, device));
  };
  const close = (device: string) => setThreads((all) => closeThread(all, device));

  const here = useMemo(() => participants.filter((p) => !p.isLocal), [participants]);
  const list: PrivateChat[] = Object.values(threads).filter((thread) => thread.open).map((thread) => {
    const person = here.find((p) => deviceOf(p.identity) === thread.device);
    return {
      ...thread,
      name: person?.name || thread.name,
      color: colorFor(person?.identity ?? thread.device),
      online: !!person,
      focusRequest: focus.device === thread.device ? focus.count : 0,
      chat: {
        items: held.items.filter((item) => item.thread === thread.device),
        sendText: (text) => sendText(thread.device, text),
        sendImage: (file) => sendImage(thread.device, file),
        draft: thread.draft,
        setDraft: (draft) => update(thread.device, () => ({ draft })),
        sending: thread.sending,
        sendFailed: thread.failed,
      },
    };
  });

  return { list, open, toggle, close };
}
