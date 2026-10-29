import { useParticipants } from '@livekit/components-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { LOL_TIERS, type LolBuild, type LolCounter, type LolMeta, type LolNamed, type LolRole, type LolTier, type LolVariant } from '../../../server/src/protocol';
import { api, ApiError } from '../api';
import { translate, useT, type MessageKey } from '../i18n';
import { getRecentChampions, saveRecentChampions } from '../identity';
import { icon, RIOT_ID } from '../lol';
import { riotOf } from '../presence';
import { useStore } from '../store';
import { X } from './Icons';

type Champ = { id: string; key: number; name: string };

/**
 * Before the game: pick a champion, see its build and matchups at a glance.
 * Icons in order, no explanations.
 */
export function LolPanel({ meta, onClose }: { meta: LolMeta; onClose: () => void }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const rank = useStore((s) => s.lolRank);
  const [champion, setChampion] = useState<string | null>(() => getRecentChampions()[0] ?? null);
  const [role, setRole] = useState<LolRole | null>(null);
  const [build, setBuild] = useState<LolBuild | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const version = meta.version!;

  useEffect(() => {
    if (!champion) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .lolBuild(champion, role, lang, rank)
      .then((b) => {
        if (cancelled) return;
        setBuild(b);
        if (!role) setRole(b.role);
      })
      .catch((err) => {
        if (cancelled) return;
        setBuild(null);
        setError(err instanceof ApiError ? err.message : translate('lol.riotDown'));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [champion, role, lang, rank]);

  const choose = (id: string) => {
    setRole(null);
    setChampion(id);
    saveRecentChampions([id, ...getRecentChampions().filter((c) => c !== id)]);
  };

  return (
    <aside className="chat-panel lol-panel">
      <div className="lol-top">
        <ChampionSearch meta={meta} onPick={choose} />
        <RankPicker />
        <button className="icon-btn small" title={t('lol.close')} aria-label={t('lol.close')} onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="lol-scroll">
        <QuickPicks meta={meta} current={champion} onPick={choose} />

        {build ? (
          <BuildView build={build} version={version} dim={loading} onRole={setRole} onChampion={choose} />
        ) : (
          error && <p className="lol-empty">{error}</p>
        )}
        {!!meta.games && meta.games < 3000 && <p className="lol-note">{t('lol.collecting', { n: meta.games.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-GB') })}</p>}
      </div>

      <RiotAccountForm />
    </aside>
  );
}

// ---------- search, rank range, quick picks ----------

/** Whose games the stats come from: this rank and above (saved on this device). */
function RankPicker() {
  const t = useT();
  const rank = useStore((s) => s.lolRank);
  return (
    <label className="lol-rank" title={t('lol.rankTitle')}>
      <select
        aria-label={t('lol.rankTitle')}
        value={rank}
        onChange={(e) => useStore.getState().setLolRank(e.target.value as LolTier)}
      >
        {LOL_TIERS.map((tier) => (
          <option key={tier} value={tier}>
            {t(`lol.rank.${tier}` as MessageKey)}
          </option>
        ))}
      </select>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}

function ChampionSearch({ meta, onPick }: { meta: LolMeta; onPick: (id: string) => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const norm = (s: string) => s.toLocaleLowerCase('tr').replace(/[^a-z0-9ğüşöçı]/g, '');
  const results = useMemo(() => {
    const n = norm(q);
    if (!n) return [];
    const all = meta.champions ?? [];
    return [...all.filter((c) => norm(c.name).startsWith(n)), ...all.filter((c) => !norm(c.name).startsWith(n) && norm(c.name).includes(n))].slice(0, 7);
  }, [q, meta.champions]);

  const pick = (id: string) => {
    onPick(id);
    setQ('');
    setOpen(false);
  };

  return (
    <form
      className="lol-search"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (results[0]) pick(results[0].id);
      }}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        value={q}
        placeholder={t('lol.search')}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && results.length > 0 && (
        <div className="lol-results">
          {results.map((c) => (
            <button key={c.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c.id)}>
              <img src={icon.champion(meta.version!, c.id)} alt="" />
              {c.name}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}

const mainsCache = new Map<string, Promise<Champ[]>>();

/** "Our champions": everyone in the call (with a Riot ID) and their most played, plus your recent lookups. */
function QuickPicks({ meta, current, onPick }: { meta: LolMeta; current: string | null; onPick: (id: string) => void }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const participants = useParticipants();
  const myRiot = useStore((s) => s.riot);
  const people = useMemo(() => {
    const out: { name: string; riotId: string; platform: string }[] = [];
    for (const p of participants) {
      const r = p.isLocal ? myRiot : riotOf(p);
      if (r && !out.some((o) => o.riotId.toLowerCase() === r.riotId.toLowerCase())) out.push({ name: p.name || r.riotId.split('#')[0]!, ...r });
    }
    return out;
  }, [participants, myRiot]);
  const [mains, setMains] = useState<Record<string, Champ[]>>({});

  useEffect(() => {
    let cancelled = false;
    for (const p of people) {
      const key = `${p.riotId.toLowerCase()}|${p.platform}|${lang}`;
      let req = mainsCache.get(key);
      if (!req) {
        req = api
          .lolMains(p.riotId, p.platform, lang)
          .then((r) => r.champions)
          .catch(() => {
            mainsCache.delete(key);
            return [];
          });
        mainsCache.set(key, req);
      }
      void req.then((list) => !cancelled && setMains((m) => ({ ...m, [p.riotId]: list })));
    }
    return () => {
      cancelled = true;
    };
  }, [people, lang]);

  const byId = useMemo(() => new Map((meta.champions ?? []).map((c) => [c.id, c])), [meta.champions]);
  const recent = getRecentChampions()
    .map((id) => byId.get(id))
    .filter((c): c is Champ => !!c);

  const rows: { label: string; champs: Champ[] }[] = [
    ...people.filter((p) => mains[p.riotId]?.length).map((p) => ({ label: p.name, champs: mains[p.riotId]! })),
    ...(recent.length ? [{ label: t('lol.recent'), champs: recent.slice(0, 6) }] : []),
  ];
  if (!rows.length) return null;

  return (
    <div className="lol-quick">
      {rows.map((r) => (
        <div key={r.label} className="lol-quick-row">
          <span className="lol-quick-label">{r.label}</span>
          <div className="lol-quick-icons">
            {r.champs.map((c) => (
              <button key={c.id} type="button" className={c.id === current ? 'on' : ''} title={c.name} onClick={() => onPick(c.id)}>
                <img src={icon.champion(meta.version!, c.id)} alt={c.name} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- the build ----------

/** Below this, the champion's win rate isn't shown (one win out of one game is not "100%"). */
const MIN_GAMES_FOR_WIN_RATE = 20;

const SHARDS = new Set([5008, 5005, 5007, 5010, 5001, 5011, 5013]);

function BuildView({
  build: b,
  version,
  dim,
  onRole,
  onChampion,
}: {
  build: LolBuild;
  version: string;
  dim: boolean;
  onRole: (r: LolRole) => void;
  onChampion: (id: string) => void;
}) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const [pick, setPick] = useState(0);
  // A different champion or role: back to the recommended build.
  useEffect(() => setPick(0), [b.champion.id, b.role]);
  const variant: Pick<LolVariant, 'core' | 'runes'> = b.variants?.[pick] ?? b;
  const item = (i: LolNamed, size: 'sm' | 'md' = 'md') => (
    <img key={i.id} className={`lol-ico ${size}`} src={icon.item(version, i.id)} alt={i.name} title={i.name} />
  );
  const ability = (k: string) => b.abilities?.find((a) => a.key === k);

  return (
    <div className={`lol-build${dim ? ' dim' : ''}`}>
      <div className="lol-hero" style={{ backgroundImage: `url(${icon.splash(b.champion.id)})` }}>
        <div className="lol-hero-text">
          <h3>{b.champion.name}</h3>
          <span className="lol-hero-sub">
            {/* A win rate from a handful of games means nothing: say so instead. */}
            {b.games >= MIN_GAMES_FOR_WIN_RATE ? (
              <span className={b.winRate >= 50 ? 'good' : 'bad'}>{t('lol.winRate', { wr: b.winRate })}</span>
            ) : (
              <span className="lol-few">{t('lol.fewData')}</span>
            )}
            <span>·</span>
            <span>{t('lol.games', { n: b.games.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-GB') })}</span>
          </span>
        </div>
        {b.roles.length > 1 && (
          <div className="lol-roles">
            {b.roles.map((r) => (
              <button key={r.role} type="button" className={r.role === b.role ? 'on' : ''} onClick={() => onRole(r.role)}>
                {t(`lol.role.${r.role}` as MessageKey)}
              </button>
            ))}
          </div>
        )}
      </div>

      {b.variants?.length > 1 && (
        <Section title={t('lol.variants')}>
          <div className="lol-variants" role="tablist">
            {b.variants.map((v, i) => (
              <button key={i} type="button" role="tab" aria-selected={i === pick} className={i === pick ? 'on' : ''} onClick={() => setPick(i)}>
                <span className="lol-variant-icons">
                  {v.runes && <img src={icon.rune(v.runes.keystone.icon)} alt={v.runes.keystone.name} title={v.runes.keystone.name} />}
                  {v.core?.[0] && <img src={icon.item(version, v.core[0].id)} alt={v.core[0].name} title={v.core[0].name} />}
                </span>
                <span className="lol-variant-text">
                  <span className={v.winRate >= 50 ? 'good' : 'bad'}>{t('lol.winRate', { wr: v.winRate })}</span>
                  <span className="muted">{t('lol.pickRate', { n: v.games, p: v.pickRate })}</span>
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {b.skills && (
        <Section title={t('lol.skills')} aside={b.skills.first ? `1–3 · ${[...b.skills.first].join(' ')}` : undefined}>
          <div className="lol-chain">
            {[...b.skills.order].map((k, i) => {
              const a = ability(k);
              return (
                <Step key={k} first={i === 0}>
                  <span className={`lol-skill k-${k}`} title={a?.name}>
                    {a ? <img src={icon.spell(version, a.image)} alt="" /> : null}
                    <b>{k}</b>
                  </span>
                </Step>
              );
            })}
          </div>
        </Section>
      )}

      {(variant.core || b.boots || b.start) && (
        <Section title={t('lol.items')}>
          <div className="lol-items">
            {b.start && <div className="lol-start">{b.start.map((i) => item(i, 'sm'))}</div>}
            <div className="lol-chain">
              {(variant.core ?? []).map((i, n) => (
                <Step key={i.id} first={n === 0}>
                  {item(i)}
                </Step>
              ))}
              {b.boots && <span className="lol-boots">{item(b.boots)}</span>}
            </div>
          </div>
        </Section>
      )}

      {(variant.runes || b.spells) && (
        <Section title={t('lol.runes')}>
          <div className="lol-runes">
            {variant.runes && (
              <>
                <img className="lol-keystone" src={icon.rune(variant.runes.keystone.icon)} alt={variant.runes.keystone.name} title={variant.runes.keystone.name} />
                <div className="lol-rune-col">
                  <div className="lol-rune-line">
                    {variant.runes.primaryRunes.map((r) => (
                      <img key={r.id} src={icon.rune(r.icon)} alt={r.name} title={r.name} />
                    ))}
                  </div>
                  <div className="lol-rune-line">
                    {variant.runes.secondaryRunes.map((r) => (
                      <img key={r.id} src={icon.rune(r.icon)} alt={r.name} title={r.name} />
                    ))}
                    <span className="lol-shards">
                      {variant.runes.shards.map((s) => (SHARDS.has(s) ? t(`lol.shard.${s}` as MessageKey) : String(s))).join(' · ')}
                    </span>
                  </div>
                </div>
              </>
            )}
            {b.spells && (
              <div className="lol-spells">
                {b.spells.map((s) => (
                  <img key={s.id} className="lol-ico md" src={icon.spell(version, s.image)} alt={s.name} title={s.name} />
                ))}
              </div>
            )}
          </div>
        </Section>
      )}

      <Section title={t('lol.matchups')}>
        {b.counters.hard.length || b.counters.easy.length ? (
          <div className="lol-counters">
            <Counters label={t('lol.hard')} list={b.counters.hard} version={version} onPick={onChampion} kind="hard" />
            <Counters label={t('lol.easy')} list={b.counters.easy} version={version} onPick={onChampion} kind="easy" />
          </div>
        ) : (
          <p className="lol-note">{t('lol.noMatchups', { name: b.champion.name, n: b.games })}</p>
        )}
      </Section>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="lol-section">
      <div className="lol-section-title">
        <span>{title}</span>
        {aside && <span className="lol-aside">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** One link in a "first › second › third" chain. */
function Step({ first, children }: { first: boolean; children: ReactNode }) {
  return (
    <>
      {!first && <span className="lol-arrow" aria-hidden />}
      {children}
    </>
  );
}

function Counters({
  label,
  list,
  version,
  onPick,
  kind,
}: {
  label: string;
  list: LolCounter[];
  version: string;
  onPick: (id: string) => void;
  kind: 'hard' | 'easy';
}) {
  if (!list.length) return null;
  return (
    <div className={`lol-counter ${kind}`}>
      <span className="lol-counter-label">{label}</span>
      <div className="lol-counter-list">
        {list.map((c) => (
          <button
            key={c.champion.id}
            type="button"
            className={c.games < 15 ? 'few' : ''}
            title={`${c.champion.name} · ${translate(c.games < 15 ? 'lol.fewGames' : 'lol.games', { n: c.games })}`}
            onClick={() => onPick(c.champion.id)}
          >
            <img src={icon.champion(version, c.champion.id)} alt={c.champion.name} />
            <span className="lol-counter-wr">{translate('lol.pct', { n: Math.round(c.winRate) })}</span>
            <span className="lol-counter-games">{translate('lol.games', { n: c.games })}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- Riot ID ----------

/** Your Riot ID: for the post-game card and so friends see your champions. */
function RiotAccountForm() {
  const t = useT();
  const riot = useStore((s) => s.riot);
  const [value, setValue] = useState(riot?.riotId ?? '');
  const [platform, setPlatform] = useState<'tr1' | 'euw1' | 'eun1'>(riot?.platform ?? 'tr1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  if (!editing)
    return riot ? (
      <footer className="lol-account linked">
        <span className="lol-dot" />
        <span className="small lol-account-id">{riot.riotId}</span>
        <span className="small muted">{riot.platform === 'tr1' ? 'TR' : riot.platform === 'euw1' ? 'EUW' : 'EUNE'}</span>
        <button type="button" className="lol-link" onClick={() => setEditing(true)}>
          {t('lol.change')}
        </button>
      </footer>
    ) : (
      <footer className="lol-account">
        <button type="button" className="lol-add" onClick={() => setEditing(true)}>
          <span className="lol-add-plus" aria-hidden>
            +
          </span>
          <span>
            <span className="lol-add-title">{t('lol.addRiot')}</span>
            <span className="small muted">{t('lol.addRiotHint')}</span>
          </span>
        </button>
      </footer>
    );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!RIOT_ID.test(v)) return setError(t('lol.badRiotId'));
    setBusy(true);
    setError(null);
    try {
      const res = await api.lolAccount(v);
      useStore.getState().setRiot({ riotId: res.riotId, platform });
      setValue(res.riotId);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? t('lol.notFound') : err instanceof Error ? err.message : t('lol.riotDown'));
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <footer className="lol-account editing">
      <form onSubmit={submit}>
        <label className="lol-field">
          <span className="lol-field-label">{t('lol.riotIdLabel')}</span>
          <input
            ref={input}
            className="field"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder={t('lol.riotIdPlaceholder')}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <span className="small muted">{t('lol.riotIdHint')}</span>
        {error && <p className="form-error small">{error}</p>}
        <div className="lol-account-row">
          <select className="field" aria-label={t('lol.region')} value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)}>
            <option value="tr1">TR</option>
            <option value="euw1">EUW</option>
            <option value="eun1">EUNE</option>
          </select>
          {riot && (
            <button
              type="button"
              className="lol-link danger"
              onClick={() => {
                useStore.getState().setRiot(null);
                setValue('');
                setEditing(false);
              }}
            >
              {t('lol.remove')}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn subtle small-btn" onClick={() => (setEditing(false), setError(null), setValue(riot?.riotId ?? ''))}>
            {t('lol.cancel')}
          </button>
          <button className="btn primary small-btn" disabled={busy || !value.trim()}>
            {busy ? '…' : t('lol.save')}
          </button>
        </div>
      </form>
    </footer>
  );
}
