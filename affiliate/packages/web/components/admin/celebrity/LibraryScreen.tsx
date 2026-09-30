'use client';

/*
 * The paparazzi library import (admin, no artboard): pick the library CSV
 * (or paste it), Check (POST /v1/editorial/library/import, dry_run: the
 * API's parse and database pre-pass, nothing written), then Import (draft
 * looks; new celebrities unreviewed; a second run changes nothing). The
 * results: the API's summary and the created looks. Files over 900 000
 * characters go through the owner's server line instead
 * (deploy/linode/looks.sh import). Signed out: the columns and the TEST
 * example only; nothing is sent.
 */

import { useEffect, useState } from 'react';
import { AdminSection } from '@/components/admin/AdminSection';
import { PageNote } from '@/components/shell/PageBody';
import { Banner, Button, Field, Tag, Textarea } from '@/components/ui';
import { getToken } from '@/lib/api';
import { LIBRARY_COLUMNS, LIBRARY_EXAMPLE, statusLabel, type LibraryCheck, type LibrarySummary, type OwnershipStatementRef } from '@/lib/celebrity-admin';
import { downloadCsv } from '@/lib/download';
import { send } from './useLiveData';
import styles from './admin.module.css';

const MAX_CHARS = 900_000;

export function LibraryScreen() {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [check, setCheck] = useState<LibraryCheck | null>(null);
  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [error, setError] = useState<{ title: string; problems: string[] } | null>(null);
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => setSignedIn(!!getToken()), []);

  async function readFile(f: File | undefined) {
    if (!f) return;
    setFileName(f.name);
    setCheck(null);
    setSummary(null);
    setError(null);
    setText(await f.text());
  }

  async function run(dryRun: boolean) {
    setBusy(dryRun ? 'check' : 'import');
    setError(null);
    const r = await send<(LibraryCheck & { dry_run: true }) | { dry_run: false; ok: true; summary: LibrarySummary }>('/v1/editorial/library/import', { csv_text: text, dry_run: dryRun });
    setBusy(null);
    if (!r.ok) {
      const problems = Array.isArray(r.body?.problems) ? (r.body?.problems as string[]) : [];
      setError({ title: `${dryRun ? 'Check' : 'Import'} refused: ${r.message}`, problems });
      return;
    }
    if (r.data.dry_run) {
      setCheck(r.data);
      setSummary(null);
    } else {
      setSummary(r.data.summary);
    }
  }

  const tooBig = text.length > MAX_CHARS;
  return (
    <>
      <h1 className="sr-only">Admin: library import</h1>
      <AdminSection title="Library import" titleId="library-title">
        <PageNote>
          One row per outfit piece of a paparazzi moment; the rows of one video are one look. The whole file is refused if any row lacks its licence facts,
          names a sensitive place or uses endorsement wording. Looks arrive as drafts and new celebrities as unreviewed: nothing is published by an import.
          Large files: the server line <code className={styles.mono}>bash /opt/afflino/affiliate/deploy/linode/looks.sh import</code>.
        </PageNote>
        <div className={styles.split}>
          <div className={styles.stack}>
            <div className={styles.fileRow}>
              <span className={styles.h4}>Library file (CSV)</span>
              <div className={styles.actions}>
                {/* The native input is visually hidden; its label is the system's secondary button. */}
                <input id="library-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void readFile(e.target.files?.[0])} />
                <label htmlFor="library-file" className={styles.fileButton}>
                  Choose a CSV file
                </label>
                <span className={styles.muted} aria-live="polite">
                  {fileName ?? 'No file chosen'}
                </span>
              </div>
            </div>
            <Field label="Or paste it" hint={fileName ? `${fileName}: ${text.length.toLocaleString('en-IN')} characters` : `At most ${MAX_CHARS.toLocaleString('en-IN')} characters.`} error={tooBig ? 'Too large for the admin: use the server line.' : undefined}>
              <Textarea rows={8} value={text} onChange={(e) => { setText(e.target.value); setCheck(null); setSummary(null); }} spellCheck={false} />
            </Field>
            <div className={styles.actions}>
              <Button disabled={!signedIn || !text.trim() || tooBig || busy !== null} onClick={() => void run(true)}>
                {busy === 'check' ? 'Checking…' : 'Check (writes nothing)'}
              </Button>
              <Button variant="primary" disabled={!signedIn || !check?.ok || tooBig || busy !== null} onClick={() => void run(false)}>
                {busy === 'import' ? 'Importing…' : 'Import as drafts'}
              </Button>
              <Button variant="ghost" onClick={() => downloadCsv('library.example.csv', `${LIBRARY_EXAMPLE}\n`)}>
                Download the TEST example
              </Button>
            </div>
            {!signedIn ? <p className={styles.muted}>Sign in with the dev token (/login) to check or import.</p> : null}
            {error ? (
              <Banner title={error.title}>
                {error.problems.length ? (
                  <ul className={styles.problems}>
                    {error.problems.slice(0, 50).map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                ) : null}
              </Banner>
            ) : null}
            {check ? <CheckResult check={check} /> : null}
            {summary ? <ImportResult summary={summary} /> : null}
          </div>
          <div>
            <h2 className={styles.h4}>Columns</h2>
            <table className={styles.matrix}>
              <thead>
                <tr>
                  <th>Column</th>
                  <th />
                  <th>What goes in it</th>
                </tr>
              </thead>
              <tbody>
                {LIBRARY_COLUMNS.map((c) => (
                  <tr key={c.name}>
                    <td className={styles.mono}>{c.name}</td>
                    <td>{c.required ? <Tag variant="accent">Required</Tag> : <Tag variant="neutral">Optional</Tag>}</td>
                    <td>{c.what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h2 className={`${styles.h4} ${styles.gapTop4}`}>
              TEST example (fictional people, example.com)
            </h2>
            <pre className={styles.pre}>{LIBRARY_EXAMPLE}</pre>
          </div>
        </div>
      </AdminSection>
    </>
  );
}

function CheckResult({ check }: { check: LibraryCheck }) {
  return (
    <div className={styles.panel}>
      <h2 className={styles.h4}>Check: {check.ok ? 'ready to import' : 'refused'}</h2>
      <p className={check.ok ? styles.okLine : styles.error}>
        {check.rows} row(s), {check.looks} look(s): {check.looks_new} new, {check.looks_existing} already imported; {check.pieces} piece(s).
      </p>
      <OwnershipLine count={check.licence_from_statement} statement={check.ownership_statement} />
      {check.problems.length ? (
        <ul className={styles.problems}>
          {check.problems.slice(0, 50).map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {check.celebrities.length ? (
        <table className={`${styles.matrix} ${styles.gapTop2}`}>
          <thead>
            <tr>
              <th>Celebrity</th>
              <th>Known</th>
              <th>Status</th>
              <th>Looks</th>
            </tr>
          </thead>
          <tbody>
            {check.celebrities.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td>{c.known ? 'Yes' : 'New (unreviewed)'}</td>
                <td>{c.rights_status ? statusLabel(c.rights_status) : 'Unreviewed'}</td>
                <td>{c.looks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

/** Which looks take their licence from the owner's ownership statement (rows without licence columns). */
function OwnershipLine({ count, statement }: { count?: number; statement?: OwnershipStatementRef | null }) {
  if (!count || !statement) return null;
  return (
    <p className={`${styles.muted} ${styles.gapTop2}`}>
      Licence: {count} look(s) from the owner&apos;s ownership statement of {statement.recorded_at.slice(0, 10)} ({statement.copyright_owner}); the footage
      only, each celebrity&apos;s own rights still go through their review.
    </p>
  );
}

function ImportResult({ summary }: { summary: LibrarySummary }) {
  return (
    <div className={styles.panel}>
      <h2 className={styles.h4}>Imported</h2>
      <dl className={styles.facts}>
        <dt>Looks</dt>
        <dd>
          {summary.looks_created} new (drafts), {summary.looks_updated} updated, {summary.looks_unchanged} unchanged, {summary.looks_not_draft_kept} kept (no longer drafts)
        </dd>
        <dt>Celebrities</dt>
        <dd>
          {summary.celebrities_created} new (unreviewed), {summary.celebrities_matched} matched, {summary.celebrities_flagged_minor} flagged minors
        </dd>
        <dt>Assets</dt>
        <dd>
          {summary.assets_created} new, {summary.assets_updated} updated
        </dd>
        <dt>Pieces</dt>
        <dd>
          {summary.pieces_created} new, {summary.pieces_updated} updated
        </dd>
      </dl>
      <OwnershipLine count={summary.licence_from_statement} statement={summary.ownership_statement} />
      {summary.licence_kept?.length ? (
        <ul className={`${styles.list} ${styles.gapTop2}`}>
          {summary.licence_kept.map((k) => (
            <li key={`${k.kind}:${k.ref}`} className={styles.listRow}>
              <span className={styles.mono}>{k.ref}</span>{' '}
              <span className={styles.muted}>
                · {k.kind}: kept as a person set it (the file would widen {k.kept.join(', ')}; the rights reviewer changes that)
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {summary.created_looks.length ? (
        <ul className={`${styles.list} ${styles.gapTop2}`}>
          {summary.created_looks.map((l) => (
            <li key={l.look_id} className={styles.listRow}>
              <a href={`/admin/looks/${l.look_id}`}>{l.key}</a> <span className={styles.muted}>· {l.celebrity} ({statusLabel(l.celebrity_status)})</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className={`${styles.muted} ${styles.gapTop2}`}>
        Next: the celebrities&apos; rights review (Celebrities), then the pieces&apos; products in each look.
      </p>
    </div>
  );
}
