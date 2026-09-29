'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  STATES,
  loadLooks,
  nextTransition,
  saveLooks,
  stateLabel,
  type ConsoleLook,
  type ConsoleState,
  type PublishRecord,
  type Transition,
} from '../../lib/console';
import styles from './page.module.css';

const EMPTY_PUBLISH: PublishRecord = {
  url: '',
  postId: '',
  publisher: '',
  placement: '',
  creativeVersion: '',
};

export default function ConsoleBoard() {
  const [looks, setLooks] = useState<ConsoleLook[]>([]);
  const [pauseId, setPauseId] = useState<string | null>(null);
  const [pauseReason, setPauseReason] = useState('');
  const [publishId, setPublishId] = useState<string | null>(null);
  const [publishForm, setPublishForm] = useState<PublishRecord>(EMPTY_PUBLISH);

  useEffect(() => {
    setLooks(loadLooks());
  }, []);

  function update(next: ConsoleLook[]) {
    setLooks(next);
    saveLooks(next);
  }

  function toggleCheck(look: ConsoleLook, transition: Transition, gateId: string) {
    const key = `${transition.id}:${gateId}`;
    update(
      looks.map((l) =>
        l.id === look.id ? { ...l, checks: { ...l.checks, [key]: !l.checks[key] } } : l,
      ),
    );
  }

  function gatesDone(look: ConsoleLook, transition: Transition): boolean {
    return transition.gates.every((g) => look.checks[`${transition.id}:${g.id}`]);
  }

  function move(look: ConsoleLook, to: ConsoleState) {
    update(
      looks.map((l) =>
        l.id === look.id ? { ...l, state: to, updatedAt: new Date().toISOString() } : l,
      ),
    );
  }

  function confirmPause(look: ConsoleLook) {
    if (!pauseReason.trim()) return;
    update(
      looks.map((l) =>
        l.id === look.id
          ? {
              ...l,
              resumeState: l.state,
              state: 'paused',
              pauseReason: pauseReason.trim(),
              updatedAt: new Date().toISOString(),
            }
          : l,
      ),
    );
    setPauseId(null);
    setPauseReason('');
  }

  function resume(look: ConsoleLook) {
    move(look, look.resumeState ?? 'draft');
  }

  function confirmPublish(look: ConsoleLook) {
    update(
      looks.map((l) =>
        l.id === look.id
          ? {
              ...l,
              state: 'published',
              publishRecord: { ...publishForm },
              updatedAt: new Date().toISOString(),
            }
          : l,
      ),
    );
    setPublishId(null);
    setPublishForm(EMPTY_PUBLISH);
  }

  const publishReady =
    publishForm.url.trim() !== '' &&
    publishForm.postId.trim() !== '' &&
    publishForm.publisher.trim() !== '' &&
    publishForm.placement.trim() !== '' &&
    publishForm.creativeVersion.trim() !== '';

  return (
    <div>
      <h1 className={styles.heading}>Editorial console</h1>
      <p className={styles.sub}>
        Looks pipeline — moves are saved locally in this browser (demo data, no API
        wiring yet).
      </p>

      <div className={styles.board}>
        {STATES.map((s) => (
          <section key={s.id} className={styles.column} aria-label={s.label}>
            <h2 className={styles.columnTitle}>
              {s.label}
              <span className={styles.count}>
                {looks.filter((l) => l.state === s.id).length}
              </span>
            </h2>
            <div className={styles.cards}>
              {looks
                .filter((l) => l.state === s.id)
                .map((look) => (
                  <LookCard
                    key={look.id}
                    look={look}
                    onToggleCheck={(t, g) => toggleCheck(look, t, g)}
                    onMove={(to) => move(look, to)}
                    onResume={() => resume(look)}
                    onStartPause={() => {
                      setPauseId(look.id);
                      setPauseReason(look.pauseReason ?? '');
                    }}
                    gatesDone={(t) => gatesDone(look, t)}
                    onStartPublish={() => {
                      setPublishId(look.id);
                      setPublishForm(EMPTY_PUBLISH);
                    }}
                  />
                ))}
            </div>
          </section>
        ))}
      </div>

      {pauseId && (
        <Dialog title="Pause / withdraw" onClose={() => setPauseId(null)}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Reason (required)</span>
            <textarea
              value={pauseReason}
              onChange={(e) => setPauseReason(e.target.value)}
              className={styles.textarea}
              rows={3}
              placeholder="e.g. Brand requested takedown review"
            />
          </label>
          <div className={styles.dialogActions}>
            <button
              type="button"
              className={styles.primary}
              disabled={pauseReason.trim() === ''}
              onClick={() => {
                const look = looks.find((l) => l.id === pauseId);
                if (look) confirmPause(look);
              }}
            >
              Confirm pause
            </button>
            <button type="button" className={styles.ghost} onClick={() => setPauseId(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}

      {publishId && (
        <Dialog title="Record live post" onClose={() => setPublishId(null)}>
          <p className={styles.dialogHint}>
            Required before a look can move to Published.
          </p>
          {(
            [
              ['url', 'URL'],
              ['postId', 'Post ID'],
              ['publisher', 'Publisher'],
              ['placement', 'Placement'],
              ['creativeVersion', 'Creative version'],
            ] as [keyof PublishRecord, string][]
          ).map(([key, label]) => (
            <label key={key} className={styles.field}>
              <span className={styles.fieldLabel}>{label}</span>
              <input
                value={publishForm[key]}
                onChange={(e) =>
                  setPublishForm((f) => ({ ...f, [key]: e.target.value }))
                }
                className={styles.input}
              />
            </label>
          ))}
          <div className={styles.dialogActions}>
            <button
              type="button"
              className={styles.primary}
              disabled={!publishReady}
              onClick={() => {
                const look = looks.find((l) => l.id === publishId);
                if (look) confirmPublish(look);
              }}
            >
              Publish
            </button>
            <button type="button" className={styles.ghost} onClick={() => setPublishId(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.dialogTitle}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

interface CardProps {
  look: ConsoleLook;
  onToggleCheck: (t: Transition, gateId: string) => void;
  onMove: (to: ConsoleState) => void;
  onResume: () => void;
  onStartPause: () => void;
  gatesDone: (t: Transition) => boolean;
  onStartPublish: () => void;
}

function LookCard({
  look,
  onToggleCheck,
  onMove,
  onResume,
  onStartPause,
  gatesDone,
  onStartPublish,
}: CardProps) {
  const next = nextTransition(look.state);
  const ready = next ? gatesDone(next) : false;

  return (
    <article className={styles.card}>
      <Link href={`/console/looks/${look.id}`} className={styles.cardTitle}>
        {look.title}
      </Link>
      <p className={styles.cardMeta}>
        {look.sourcePage} · {look.category} · {stateLabel(look.state)}
      </p>

      {look.state === 'paused' && look.pauseReason && (
        <p className={styles.pauseNote}>Paused: {look.pauseReason}</p>
      )}
      {look.state === 'published' && look.publishRecord && (
        <p className={styles.publishNote}>
          Live: {look.publishRecord.publisher} · {look.publishRecord.postId}
        </p>
      )}

      {next && (
        <div className={styles.gates}>
          <p className={styles.gatesTitle}>To advance — {next.label}</p>
          {next.gates.map((g) => {
            const key = `${next.id}:${g.id}`;
            const checked = !!look.checks[key];
            return (
              <label key={g.id} className={styles.gate}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleCheck(next, g.id)}
                />
                <span className={checked ? styles.gateDone : undefined}>{g.label}</span>
              </label>
            );
          })}
          <button
            type="button"
            className={styles.advance}
            disabled={!ready}
            title={ready ? next.label : 'Complete all gates to advance'}
            onClick={() => (next.recordPublish ? onStartPublish() : onMove(next.to))}
          >
            {next.label}
          </button>
        </div>
      )}

      <div className={styles.cardActions}>
        {look.state === 'paused' ? (
          <button type="button" className={styles.ghost} onClick={onResume}>
            Resume
          </button>
        ) : (
          <button type="button" className={styles.ghost} onClick={onStartPause}>
            Pause / withdraw
          </button>
        )}
      </div>
    </article>
  );
}
