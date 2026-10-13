// Remote control: how a key press from the controller is reproduced on the shared computer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planKey } from '../src/keys.ts';
const k = (code: string, key: string, m: Partial<Record<'shift'|'ctrl'|'alt'|'meta', boolean>> = {}, down = true) =>
  planKey({ t: 'key', code, key, down, shift: false, ctrl: false, alt: false, meta: false, ...m });
const cases: [string, unknown, unknown][] = [
  ['letter', k('KeyA','a'), { type: 'type', text: 'a' }],
  ['capital', k('KeyA','A',{shift:true}), { type: 'type', text: 'A' }],
  ['turkish ş', k('Semicolon','ş'), { type: 'type', text: 'ş' }],
  ['turkish İ', k('Quote','İ',{shift:true}), { type: 'type', text: 'İ' }],
  ['AltGr @ (windows)', k('KeyQ','@',{ctrl:true,alt:true}), { type: 'type', text: '@' }],
  ['mac option char', k('KeyE','€',{alt:true}), { type: 'type', text: '€' }],
  ['ctrl+c', k('KeyC','c',{ctrl:true}), { type: 'tap', key: 'c', mods: ['control'] }],
  ['cmd+v', k('KeyV','v',{meta:true}), { type: 'tap', key: 'v', mods: ['command'] }],
  ['cmd+shift+z', k('KeyZ','z',{meta:true,shift:true}), { type: 'tap', key: 'z', mods: ['shift','command'] }],
  ['enter', k('Enter','Enter'), { type: 'tap', key: 'enter', mods: [] }],
  ['shift+arrow', k('ArrowLeft','ArrowLeft',{shift:true}), { type: 'tap', key: 'left', mods: ['shift'] }],
  ['alt+tab', k('Tab','Tab',{alt:true}), { type: 'tap', key: 'tab', mods: ['alt'] }],
  ['space types a space', k('Space',' '), { type: 'type', text: ' ' }],
  ['F5', k('F5','F5'), { type: 'tap', key: 'f5', mods: [] }],
  ['modifier alone ignored', k('ShiftLeft','Shift',{shift:true}), null],
  ['key up ignored', k('KeyA','a',{},false), null],
  ['unknown key ignored', k('LaunchMail','LaunchMail'), null],
  ['emoji typed', k('KeyX','😀'), { type: 'type', text: '😀' }],
];
for (const [name, got, want] of cases) test(name, () => assert.deepEqual(got, want));
