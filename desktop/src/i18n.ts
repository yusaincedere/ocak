// Strings for the desktop app's own UI: tray menu, dialogs, overlay, banner and setup page.
// The language follows the web app (it saves `language` into the desktop settings); Turkish by default.
import { getSettings } from './settings';

const tr = {
  'tray.inCall': 'Görüşmede · {room} · {n} {people}',
  'tray.person': 'kişi',
  'tray.people': 'kişi',
  'tray.tooltipInCall': 'Ocak — görüşmede ({n})',
  'tray.tooltipMuted': ' · sessiz',
  'tray.mute': 'Sessize al',
  'tray.deafen': 'Sağırlaştır',
  'tray.leave': 'Görüşmeden ayrıl',
  'tray.open': "Ocak'ı aç",
  'tray.changeServer': 'Sunucuyu değiştir…',
  'tray.quit': 'Çık',

  'connect.notAllowed': 'İzin verilmedi',
  'connect.invalid': 'Geçerli bir adres gir. https:// olmalı (düz http yalnızca localhost için çalışır).',
  'connect.unreachable': '{url} adresine ulaşılamadı ({error})',

  'control.someone': 'Biri',
  'control.busy': 'Bu ekranı zaten başka biri kontrol ediyor.',
  'control.onlyScreen': 'Yalnızca tüm ekran paylaşımı kontrol edilebilir.',
  'control.unavailable': 'Uzaktan kontrol bu bilgisayarda kullanılamıyor.',
  'control.allow10': '10 dakika izin ver',
  'control.allowUntilStop': 'Ben durdurana kadar izin ver',
  'control.deny': 'Reddet',
  'control.title': 'Uzaktan kontrol isteği',
  'control.message': '{name} ekranını kontrol etmek istiyor',
  'control.detail':
    'Bu bilgisayarda fareni hareket ettirebilir, tıklayabilir ve yazı yazabilir.\n\nEkranın üstündeki kırmızı çubuktan veya {shortcut} ile istediğin an durdurabilirsin.',
  'control.macAccessibility': "Sistem Ayarları → Gizlilik ve Güvenlik → Erişilebilirlik altında Ocak'a izin ver, sonra tekrar dene.",
  'banner.text': '{name} ekranını kontrol ediyor',
  'banner.stop': 'Durdur',

  'overlay.mute': 'Sessize al',
  'overlay.unmute': 'Sesi aç',
  'overlay.deafen': 'Sağırlaştır',
  'overlay.undeafen': 'Sağırlaştırmayı kapat',
  'overlay.leave': 'Görüşmeden ayrıl',
  'overlay.open': "Ocak'ı aç",
  'overlay.you': '(sen)',
  'overlay.more': '+{n} kişi daha',
  'overlay.live': 'CANLI',

  'setup.title': 'Sunucuna bağlan',
  'setup.intro': 'Ocak sunucunun adresini gir.',
  'setup.address': 'Sunucu adresi',
  'setup.connect': 'Bağlan',
};

type Key = keyof typeof tr;

const en: Record<Key, string> = {
  'tray.inCall': 'In call · {room} · {n} {people}',
  'tray.person': 'person',
  'tray.people': 'people',
  'tray.tooltipInCall': 'Ocak — in call ({n})',
  'tray.tooltipMuted': ' · muted',
  'tray.mute': 'Mute',
  'tray.deafen': 'Deafen',
  'tray.leave': 'Leave call',
  'tray.open': 'Open Ocak',
  'tray.changeServer': 'Change server…',
  'tray.quit': 'Quit',

  'connect.notAllowed': 'Not allowed',
  'connect.invalid': 'Enter a valid address. It must use https:// (plain http only works for localhost).',
  'connect.unreachable': 'Could not reach {url} ({error})',

  'control.someone': 'Someone',
  'control.busy': 'Someone is already controlling this screen.',
  'control.onlyScreen': 'Only a whole-screen share can be controlled.',
  'control.unavailable': 'Remote control is not available on this computer.',
  'control.allow10': 'Allow for 10 minutes',
  'control.allowUntilStop': 'Allow until I stop it',
  'control.deny': 'Deny',
  'control.title': 'Remote control request',
  'control.message': '{name} wants to control your screen',
  'control.detail':
    'They will be able to move your mouse, click and type on this computer.\n\nYou can stop it at any time with the red bar at the top of the screen or {shortcut}.',
  'control.macAccessibility': 'Allow Ocak in System Settings → Privacy & Security → Accessibility, then try again.',
  'banner.text': '{name} is controlling your screen',
  'banner.stop': 'Stop',

  'overlay.mute': 'Mute',
  'overlay.unmute': 'Unmute',
  'overlay.deafen': 'Deafen',
  'overlay.undeafen': 'Undeafen',
  'overlay.leave': 'Leave call',
  'overlay.open': 'Open Ocak',
  'overlay.you': '(you)',
  'overlay.more': '+{n} more',
  'overlay.live': 'LIVE',

  'setup.title': 'Connect to your server',
  'setup.intro': 'Enter the address of your Ocak server.',
  'setup.address': 'Server address',
  'setup.connect': 'Connect',
};

export type Lang = 'tr' | 'en';
export const isLang = (v: unknown): v is Lang => v === 'tr' || v === 'en';

const dictionaries: Record<Lang, Record<Key, string>> = { tr, en };

export function t(key: Key, params: Record<string, string | number> = {}, lang: Lang = getSettings().language): string {
  const text = dictionaries[lang]?.[key] ?? en[key];
  return text.replace(/\{(\w+)\}/g, (m, p: string) => (p in params ? String(params[p]) : m));
}

/** All strings under one prefix (e.g. "overlay"), keyed without it, for the small static pages. */
export function pageStrings(prefix: 'overlay' | 'setup', lang: Lang = getSettings().language): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(dictionaries[lang])) if (k.startsWith(`${prefix}.`)) out[k.slice(prefix.length + 1)] = v;
  return out;
}
