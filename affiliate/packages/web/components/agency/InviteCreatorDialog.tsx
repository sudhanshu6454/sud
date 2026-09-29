'use client';

/*
 * "Invite creator" (3e) — a demo dialog. The fields are validated; nothing
 * is sent: no email, no API call (no v1 endpoint for agencies exists). A
 * valid invite is kept in this browser and listed under the roster.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Dialog, Field, Input, Select } from '@/components/ui';
import { PLATFORM_NAME, type Platform } from '@/lib/demo/afflino';
import { AGENCY_INVITE_PLATFORMS } from '@/lib/demo/agency';
import { validateInvite, type FieldErrors, type Invite, type InviteDraft } from './agencyModel';
import styles from './AgencyDialogs.module.css';

const EMPTY: InviteDraft = { name: '', email: '', platform: '', handle: '' };
const FORM_ID = 'agency-invite-form';
const ORDER: ReadonlyArray<keyof InviteDraft> = ['name', 'email', 'platform', 'handle'];

export interface InviteCreatorDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (invite: Omit<Invite, 'id' | 'createdAt'>) => void;
}

export function InviteCreatorDialog({ open, onClose, onSave }: InviteCreatorDialogProps) {
  const [draft, setDraft] = useState<InviteDraft>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors<keyof InviteDraft>>({});
  const [saved, setSaved] = useState<Omit<Invite, 'id' | 'createdAt'> | null>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (open) {
      setDraft(EMPTY);
      setErrors({});
      setSaved(null);
    }
  }, [open]);

  useEffect(() => {
    if (saved) doneRef.current?.focus();
  }, [saved]);

  const set = (key: keyof InviteDraft) => (value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = validateInvite(draft, AGENCY_INVITE_PLATFORMS);
    if (!result.ok) {
      setErrors(result.errors);
      const first = ORDER.find((k) => result.errors[k]);
      if (first) formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    onSave(result.value);
    setSaved(result.value);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Invite creator"
      actions={
        saved ? (
          <Button ref={doneRef} variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form={FORM_ID}>
              Save invite
            </Button>
          </>
        )
      }
    >
      {saved ? (
        <div role="status" className={styles.success}>
          <p className={styles.successTitle}>Invite saved — demo only.</p>
          <p>
            {saved.name} ({PLATFORM_NAME[saved.platform]} · {saved.handle}) is listed under the roster as invited. No email
            was sent to {saved.email}: this demo sends nothing and keeps the invite in this browser.
          </p>
        </div>
      ) : (
        <form id={FORM_ID} ref={formRef} className={styles.form} onSubmit={submit} noValidate>
          <p className={styles.note}>Demo: no email is sent. The invite is kept in this browser only.</p>
          <Field label="Creator’s name" error={errors.name} required>
            <Input name="name" autoComplete="off" value={draft.name} onChange={(e) => set('name')(e.target.value)} />
          </Field>
          <Field label="Email" error={errors.email} required>
            <Input
              name="email"
              type="email"
              autoComplete="off"
              placeholder="name@example.com"
              value={draft.email}
              onChange={(e) => set('email')(e.target.value)}
            />
          </Field>
          <Field label="Main platform" error={errors.platform} required>
            <Select
              name="platform"
              placeholder="Choose a platform"
              value={draft.platform}
              onChange={(e) => set('platform')(e.target.value)}
              options={AGENCY_INVITE_PLATFORMS.map((p: Platform) => ({ value: p, label: PLATFORM_NAME[p] }))}
            />
          </Field>
          <Field label="Handle or channel" error={errors.handle} required>
            <Input
              name="handle"
              autoComplete="off"
              placeholder="@demo.handle"
              value={draft.handle}
              onChange={(e) => set('handle')(e.target.value)}
            />
          </Field>
        </form>
      )}
    </Dialog>
  );
}
