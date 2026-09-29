'use client';

/*
 * "Add brand client" (3e) — a demo dialog. The fields are validated
 * (GSTIN with lib/validators, shape only); nothing is sent: no invitation
 * email, no API call. A valid client is kept in this browser and shown as a
 * pending cell among the brand clients; its workspace does not exist, so the
 * cell is not a link.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Dialog, Field, Input, Select } from '@/components/ui';
import { AGENCY_CLIENT_CATEGORIES } from '@/lib/demo/agency';
import { validateClient, type ClientDraft, type FieldErrors, type PendingClient } from './agencyModel';
import styles from './AgencyDialogs.module.css';

const EMPTY: ClientDraft = { name: '', category: '', email: '', gstin: '' };
const FORM_ID = 'agency-client-form';
const ORDER: ReadonlyArray<keyof ClientDraft> = ['name', 'category', 'email', 'gstin'];

export interface AddClientDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (client: Omit<PendingClient, 'id' | 'createdAt'>) => void;
}

export function AddClientDialog({ open, onClose, onSave }: AddClientDialogProps) {
  const [draft, setDraft] = useState<ClientDraft>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors<keyof ClientDraft>>({});
  const [saved, setSaved] = useState<Omit<PendingClient, 'id' | 'createdAt'> | null>(null);
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

  const set = (key: keyof ClientDraft) => (value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = validateClient(draft, AGENCY_CLIENT_CATEGORIES);
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
      title="Add brand client"
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
            <Button variant="primary" type="submit" form={FORM_ID} arrow>
              Add client
            </Button>
          </>
        )
      }
    >
      {saved ? (
        <div role="status" className={styles.success}>
          <p className={styles.successTitle}>Client saved — demo only.</p>
          <p>
            {saved.name} ({saved.category}) is shown as pending among your brand clients. No invitation was sent to{' '}
            {saved.email}, and there is no workspace to open yet: this demo sends nothing and keeps the client in this
            browser.
          </p>
        </div>
      ) : (
        <form id={FORM_ID} ref={formRef} className={styles.form} onSubmit={submit} noValidate>
          <p className={styles.note}>Demo: no invitation email is sent. The client is kept in this browser only.</p>
          <Field label="Brand name" error={errors.name} required>
            <Input name="name" autoComplete="organization" value={draft.name} onChange={(e) => set('name')(e.target.value)} />
          </Field>
          <Field label="Category" error={errors.category} required>
            <Select
              name="category"
              placeholder="Choose a category"
              value={draft.category}
              onChange={(e) => set('category')(e.target.value)}
              options={AGENCY_CLIENT_CATEGORIES.map((c) => ({ value: c, label: c }))}
            />
          </Field>
          <Field label="Contact email" error={errors.email} required>
            <Input
              name="email"
              type="email"
              autoComplete="off"
              placeholder="name@example.com"
              value={draft.email}
              onChange={(e) => set('email')(e.target.value)}
            />
          </Field>
          <Field label="GSTIN" labelSuffix="(optional)" hint="15 characters, if the brand is registered." error={errors.gstin}>
            <Input
              name="gstin"
              autoComplete="off"
              maxLength={15}
              className={styles.upper}
              value={draft.gstin}
              onChange={(e) => set('gstin')(e.target.value)}
            />
          </Field>
        </form>
      )}
    </Dialog>
  );
}
