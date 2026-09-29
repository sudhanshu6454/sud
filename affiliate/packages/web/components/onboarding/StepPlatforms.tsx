'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Field, Input, TagButton } from '@/components/ui';
import { DEMO_CONNECTED_ACCOUNTS } from '@/lib/demo/onboarding';
import { SOCIAL_PLATFORMS, connectedDetail, validateChannel, type PlatformId } from '@/lib/onboarding';
import { DemoNote } from './DemoNote';
import { FIELD_ID, type StepProps } from './fields';
import styles from './Onboarding.module.css';

type RowId = PlatformId | 'channel';

/** The row's action control: Connect / Add, or the tag that undoes it (one exists at a time). */
const controlId = (row: RowId) => `join-platform-${row}`;

/**
 * Supply step 2 (3a left half): Instagram (Meta), YouTube, Snapchat and
 * Website / Telegram. No OAuth exists, so Connect is a demo toggle that
 * fills in a TEST account (lib/demo/onboarding.ts) and the "Connected" tag
 * disconnects it again; a website or Telegram channel is only recorded for
 * manual review.
 */
export function StepPlatforms({ state, errors, dispatch, announce }: StepProps) {
  const { form } = state;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  // After a toggle the pressed control is replaced by its counterpart (same id); keep focus on that row.
  const pendingFocus = useRef<RowId | null>(null);

  useEffect(() => {
    const row = pendingFocus.current;
    if (!row) return;
    pendingFocus.current = null;
    document.getElementById(row === 'channel' && adding ? 'join-channel' : controlId(row))?.focus();
  });

  function toggle(platform: PlatformId, name: string) {
    const connecting = !form.connected[platform];
    pendingFocus.current = platform;
    dispatch({ type: 'togglePlatform', platform });
    announce(connecting ? `${name}: demo account connected.` : `${name}: disconnected.`);
  }

  function addChannel() {
    const result = validateChannel(draft);
    if (!result.ok) {
      setDraftError(result.message);
      document.getElementById('join-channel')?.focus();
      return;
    }
    dispatch({ type: 'setChannel', value: draft });
    setAdding(false);
    setDraft('');
    setDraftError(null);
    pendingFocus.current = 'channel';
    announce('Website or Telegram channel added for manual review.');
  }

  function removeChannel() {
    dispatch({ type: 'setChannel', value: '' });
    pendingFocus.current = 'channel';
    announce('Website or Telegram channel removed.');
  }

  return (
    <div className={styles.platformBlock}>
      <ul
        id={FIELD_ID.platforms}
        className={styles.platforms}
        aria-label="Platforms"
        aria-describedby={errors.platforms ? 'join-platforms-error' : undefined}
      >
        {SOCIAL_PLATFORMS.map((p) => {
          const connected = form.connected[p.id];
          return (
            <li key={p.id} className={styles.platformRow}>
              <div className={styles.platformText}>
                <div className={styles.platformName}>{p.name}</div>
                <div className={styles.platformDetail}>
                  {connected ? connectedDetail(DEMO_CONNECTED_ACCOUNTS[p.id]) : p.idle}
                </div>
              </div>
              {connected ? (
                <TagButton
                  id={controlId(p.id)}
                  selected
                  className={styles.toggleTag}
                  aria-label={`${p.name}: connected (demo account). Press to disconnect.`}
                  title="Disconnect"
                  onClick={() => toggle(p.id, p.name)}
                >
                  Connected
                </TagButton>
              ) : (
                <Button
                  id={controlId(p.id)}
                  size="sm"
                  className={styles.rowAction}
                  aria-pressed={false}
                  aria-label={`Connect ${p.name} (demo)`}
                  onClick={() => toggle(p.id, p.name)}
                >
                  Connect
                </Button>
              )}
            </li>
          );
        })}
        <li className={styles.platformRow} data-open={adding || undefined}>
          <div className={styles.platformText}>
            <div className={styles.platformName}>Website / Telegram</div>
            <div className={styles.platformDetail}>
              {form.channel ? `${form.channel} · manual review` : 'Add a URL for manual review'}
            </div>
          </div>
          {form.channel ? (
            <TagButton
              id={controlId('channel')}
              selected
              selectedVariant="outline"
              className={styles.toggleTag}
              aria-label={`Website / Telegram: ${form.channel}, in manual review. Press to remove.`}
              title="Remove"
              onClick={removeChannel}
            >
              Review
            </TagButton>
          ) : adding ? null : (
            <Button
              id={controlId('channel')}
              variant="ghost"
              size="sm"
              className={styles.rowAction}
              onClick={() => {
                setAdding(true);
                pendingFocus.current = 'channel';
              }}
            >
              Add
            </Button>
          )}
          {adding ? (
            <div id="join-channel-form" className={styles.channelForm}>
              <Field label="Website or Telegram channel" id="join-channel" error={draftError ?? undefined}>
                <Input
                  value={draft}
                  inputMode="url"
                  autoComplete="url"
                  spellCheck={false}
                  autoCapitalize="none"
                  placeholder="https://… or t.me/…"
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setDraftError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addChannel();
                    } else if (e.key === 'Escape') {
                      setAdding(false);
                      setDraftError(null);
                      pendingFocus.current = 'channel';
                    }
                  }}
                />
              </Field>
              <div className={styles.channelActions}>
                <Button variant="primary" size="sm" className={styles.rowAction} onClick={addChannel}>
                  Add for review
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.rowAction}
                  onClick={() => {
                    setAdding(false);
                    setDraftError(null);
                    pendingFocus.current = 'channel';
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </li>
      </ul>
      {errors.platforms ? (
        <p id="join-platforms-error" className={styles.groupError} role="alert">
          {errors.platforms}
        </p>
      ) : null}
      <DemoNote>
        Connect does not sign in to Instagram, YouTube or Snapchat: it fills in a TEST account, and nothing is read or
        linked.
      </DemoNote>
    </div>
  );
}
