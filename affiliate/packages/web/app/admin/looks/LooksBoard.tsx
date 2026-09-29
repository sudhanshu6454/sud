'use client';

/*
 * Editorial looks pipeline — the board that was /console. No design
 * artboard: the logic is the HEAD page unchanged (lib/console.ts, moves saved
 * in this browser's localStorage, gated transitions, pause with a reason,
 * publish with the live-post record), set in the admin shell with the
 * Afflino primitives. TEST demo looks; no API wiring yet.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { PageBody } from '@/components/shell/PageBody';
import { Button, Checkbox, Dialog, Eyebrow, Field, Input, PageHeader, Textarea } from '@/components/ui';
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
} from '@/lib/console';
import styles from './page.module.css';

const EMPTY_PUBLISH: PublishRecord = {
  url: '',
  postId: '',
  publisher: '',
  placement: '',
  creativeVersion: '',
};

const PUBLISH_FIELDS: [keyof PublishRecord, string][] = [
  ['url', 'URL'],
  ['postId', 'Post ID'],
  ['publisher', 'Publisher'],
  ['placement', 'Placement'],
  ['creativeVersion', 'Creative version'],
];

export function LooksBoard() {
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
    update(looks.map((l) => (l.id === look.id ? { ...l, checks: { ...l.checks, [key]: !l.checks[key] } } : l)));
  }

  function gatesDone(look: ConsoleLook, transition: Transition): boolean {
    return transition.gates.every((g) => look.checks[`${transition.id}:${g.id}`]);
  }

  function move(look: ConsoleLook, to: ConsoleState) {
    update(looks.map((l) => (l.id === look.id ? { ...l, state: to, updatedAt: new Date().toISOString() } : l)));
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

  const publishReady = PUBLISH_FIELDS.every(([key]) => publishForm[key].trim() !== '');

  return (
    <>
      <PageHeader
        eyebrow="Admin · Editorial"
        title="Looks pipeline"
        description="Moves are saved locally in this browser (TEST demo looks, no API wiring yet)."
        actions={<DemoBadge variant="mock" className={styles.badge} />}
      />
      <PageBody>
        <div className={styles.board}>
          {STATES.map((s) => {
            const inState = looks.filter((l) => l.state === s.id);
            return (
              <section key={s.id} className={styles.column} aria-label={s.label}>
                <h2 className={styles.columnTitle}>
                  <Eyebrow as="span">{s.label}</Eyebrow>
                  <span className={styles.count}>{inState.length}</span>
                </h2>
                <div className={styles.cards}>
                  {inState.map((look) => (
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
            );
          })}
        </div>
      </PageBody>

      <Dialog
        open={pauseId !== null}
        onClose={() => setPauseId(null)}
        title="Pause / withdraw"
        className={styles.formDialog}
        actions={
          <>
            <Button variant="ghost" onClick={() => setPauseId(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={pauseReason.trim() === ''}
              onClick={() => {
                const look = looks.find((l) => l.id === pauseId);
                if (look) confirmPause(look);
              }}
            >
              Confirm pause
            </Button>
          </>
        }
      >
        <Field label="Reason" labelSuffix="(required)" required>
          <Textarea
            value={pauseReason}
            onChange={(e) => setPauseReason(e.target.value)}
            rows={3}
            placeholder="e.g. Brand requested takedown review"
          />
        </Field>
      </Dialog>

      <Dialog
        open={publishId !== null}
        onClose={() => setPublishId(null)}
        title="Record live post"
        className={styles.formDialog}
        actions={
          <>
            <Button variant="ghost" onClick={() => setPublishId(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!publishReady}
              onClick={() => {
                const look = looks.find((l) => l.id === publishId);
                if (look) confirmPublish(look);
              }}
            >
              Publish
            </Button>
          </>
        }
      >
        <div className={styles.dialogFields}>
          <p className={styles.dialogHint}>Required before a look can move to Published.</p>
          {PUBLISH_FIELDS.map(([key, label]) => (
            <Field key={key} label={label} required>
              <Input value={publishForm[key]} onChange={(e) => setPublishForm((f) => ({ ...f, [key]: e.target.value }))} />
            </Field>
          ))}
        </div>
      </Dialog>
    </>
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

function LookCard({ look, onToggleCheck, onMove, onResume, onStartPause, gatesDone, onStartPublish }: CardProps) {
  const next = nextTransition(look.state);
  const ready = next ? gatesDone(next) : false;

  return (
    <article className={styles.card}>
      <Link href={`/admin/looks/${look.id}`} className={styles.cardTitle}>
        {look.title}
      </Link>
      <p className={styles.cardMeta}>
        {look.sourcePage} · {look.category} · {stateLabel(look.state)}
      </p>

      {look.state === 'paused' && look.pauseReason && <p className={styles.note}>Paused: {look.pauseReason}</p>}
      {look.state === 'published' && look.publishRecord && (
        <p className={styles.note}>
          Live: {look.publishRecord.publisher} · {look.publishRecord.postId}
        </p>
      )}

      {next && (
        <div className={styles.gates}>
          <Eyebrow className={styles.gatesTitle}>To advance — {next.label}</Eyebrow>
          {next.gates.map((g) => (
            <Checkbox
              key={g.id}
              className={styles.gate}
              checked={!!look.checks[`${next.id}:${g.id}`]}
              onChange={() => onToggleCheck(next, g.id)}
            >
              {g.label}
            </Checkbox>
          ))}
          <Button
            size="xs"
            variant="primary"
            disabled={!ready}
            title={ready ? next.label : 'Complete all gates to advance'}
            onClick={() => (next.recordPublish ? onStartPublish() : onMove(next.to))}
          >
            {next.label}
          </Button>
        </div>
      )}

      <div className={styles.cardActions}>
        {look.state === 'paused' ? (
          <Button size="xs" variant="ghost" onClick={onResume}>
            Resume
          </Button>
        ) : (
          <Button size="xs" variant="ghost" onClick={onStartPause}>
            Pause / withdraw
          </Button>
        )}
      </div>
    </article>
  );
}
