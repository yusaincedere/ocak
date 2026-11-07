import { useLayoutEffect, useMemo, useState, type ClipboardEvent, type CSSProperties } from 'react';
import { nameFromPaste } from '../name-paste';
import { keyframeNames, keyframesCss, moves, runCss, runLayers, runStyle, styleText, type NameStyle } from '../name-style';

/** @keyframes of everyone's names, added once each to one <style> element. */
const added = new Set<string>();
function addKeyframes(style: NameStyle) {
  let el = document.getElementById('ocak-name-keyframes') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'ocak-name-keyframes';
    document.head.append(el);
  }
  for (const rule of keyframesCss(style)) {
    if (added.has(rule)) continue;
    added.add(rule);
    try {
      el.sheet?.insertRule(rule, el.sheet.cssRules.length);
    } catch {
      /* a rule this browser doesn't understand */
    }
  }
}

/** A name with its pasted look; plain text when there is no (matching) style. */
export function StyledName({ name, style }: { name: string; style: NameStyle | null }) {
  const usable = style && styleText(style) === name ? style : null;
  const names = useMemo(() => (usable ? usable.runs.map((r) => keyframeNames(usable, r)) : []), [usable]);
  useLayoutEffect(() => {
    if (usable?.kf) addKeyframes(usable);
  }, [usable]);
  if (!usable) return <>{name}</>;
  return (
    <span className={`styled-name${usable.runs.some((r) => moves(runStyle(usable, r), usable) || runLayers(usable, r)?.some((l) => moves(l, usable))) ? ' moving' : ''}`} aria-label={name}>
      {usable.runs.map((r, i) =>
        runLayers(usable, r) ? (
          // Overlays sit exactly on the text: their place and size are ours, never pasted.
          <span key={i} aria-hidden className="styled-name-layered" style={runCss(runStyle(usable, r), names[i]!) as CSSProperties}>
            {r.t}
            {runLayers(usable, r)!.map((layer, j) => (
              <span key={j} className="styled-name-layer" style={runCss(layer, names[i]!) as CSSProperties}>
                {r.t}
              </span>
            ))}
          </span>
        ) : (
          <span key={i} aria-hidden className={moves(runStyle(usable, r), usable) ? 'styled-name-move' : undefined} style={runCss(runStyle(usable, r), names[i]!) as CSSProperties}>
            {r.t}
          </span>
        ),
      )}
    </span>
  );
}

/**
 * For name fields: pasting styled text keeps its look. Returns the pending style (only while the
 * field still says exactly the pasted text), and an onPaste handler for the input.
 */
export function useNamePaste(value: string, setValue: (v: string) => void, initial: NameStyle | null = null) {
  const [style, setStyle] = useState<NameStyle | null>(initial);
  /** pasted or cleared here (otherwise the current look, e.g. a built-in style, stays as it is) */
  const [changed, setChanged] = useState(false);
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = nameFromPaste(e.clipboardData);
    if (!pasted) return; // ordinary text: the browser pastes it
    e.preventDefault();
    setValue(pasted.text); // a styled paste is the whole name
    setStyle(pasted.style);
    setChanged(true);
  };
  const current = style && styleText(style) === value.trim() ? style : null;
  return {
    style: current,
    changed,
    clear: () => (setStyle(null), setChanged(true)),
    reset: (s: NameStyle | null) => (setStyle(s), setChanged(false)),
    onPaste,
  };
}
