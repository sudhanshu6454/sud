'use client';

/*
 * Agency workspace — 3e. TEST demo data (lib/demo/afflino.ts: the agency,
 * its three drawn brand clients and the roster; lib/demo/agency.ts): no v1
 * endpoint serves agencies, so the page carries <DemoBadge variant="mock" />.
 *
 * - Brand client cells open the client's brand workspace
 *   (/brand?workspace=<client id>, the ids app/brand/BrandShell.tsx and the
 *   sidebar switcher use).
 * - The agency share % is editable (0–50, default 15 from lib/site-copy.ts),
 *   recomputes the share column and is kept in this browser.
 * - "Invite creator" and "Add brand client" are demo dialogs: validated, and
 *   they send nothing.
 */

import Link from 'next/link';
import { useState } from 'react';
import DemoBadge from '@/components/DemoBadge';
import { ResponsiveTable, StackRow } from '@/components/admin/ResponsiveTable';
import { withWorkspace } from '@/components/shell/areas';
import { Banner, Button, Eyebrow, Field, Input, PageHeader, Skeleton, Tag, type DataTableColumn } from '@/components/ui';
import { DEMO_AGENCY, DEMO_AGENCY_CLIENTS, DEMO_AGENCY_ROSTER, PLATFORM_NAME } from '@/lib/demo/afflino';
import { DEMO_AGENCY_PERIOD } from '@/lib/demo/agency';
import { formatCount, formatCountCompact, formatINRCompactFromMinor, formatINRFromMinor } from '@/lib/format';
import { AddClientDialog } from './AddClientDialog';
import { InviteCreatorDialog } from './InviteCreatorDialog';
import {
  AGENCY_SHARE_MAX_PCT,
  AGENCY_SHARE_MIN_PCT,
  parseSharePct,
  rosterWithShare,
  totalShareMinor,
  type RosterRowWithShare,
} from './agencyModel';
import { useAgencyWorkspace } from './useAgencyWorkspace';
import styles from './AgencyWorkspace.module.css';

type Row = (typeof DEMO_AGENCY_ROSTER)[number] & RosterRowWithShare;

export function AgencyWorkspace() {
  const agency = useAgencyWorkspace();
  const [dialog, setDialog] = useState<'invite' | 'client' | null>(null);
  const [shareInput, setShareInput] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | undefined>();
  const [announcement, setAnnouncement] = useState('');

  const pct = agency.sharePct;
  const rows: Row[] = rosterWithShare(DEMO_AGENCY_ROSTER, pct);
  const total = totalShareMinor(DEMO_AGENCY_ROSTER, pct);
  const month = DEMO_AGENCY_PERIOD.monthShort;

  const shareCell = (r: Row) =>
    agency.ready ? `${formatINRFromMinor(r.shareMinor)} (${r.sharePct}%)` : <Skeleton width={110} inline />;

  const columns: ReadonlyArray<DataTableColumn<Row>> = [
    // Column widths as drawn in 3e (289 / 132 / 242 / 260 / 293 of 1216px).
    { key: 'name', header: 'Creator', tone: 'strong', width: '23.77%', cell: (r) => r.name },
    { key: 'reach', header: 'Reach', width: '10.86%', cell: (r) => formatCountCompact(r.reach) },
    { key: 'liveOffers', header: 'Live offers', width: '19.9%', cell: (r) => formatCount(r.liveOffers) },
    { key: 'earned', header: `Earned · ${month}`, width: '21.38%', cell: (r) => formatINRFromMinor(r.earnedMinor) },
    { key: 'share', header: 'Agency share', cell: shareCell },
  ];

  function onShareChange(value: string) {
    setShareInput(value);
    const check = parseSharePct(value);
    if (!check.ok) {
      setShareError(check.message);
      return;
    }
    setShareError(undefined);
    if (check.value !== pct) {
      agency.setSharePct(check.value);
      setAnnouncement(
        `Agency share set to ${check.value}%. ${month} total ${formatINRFromMinor(totalShareMinor(DEMO_AGENCY_ROSTER, check.value))}.`,
      );
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={`${DEMO_AGENCY.name} · Agency`}
        title={`${formatCount(DEMO_AGENCY.creators)} creators · ${formatCount(DEMO_AGENCY.brandClients)} brand clients`}
        actions={
          <>
            <DemoBadge variant="mock" className={styles.badge} />
            <Button variant="secondary" className={styles.headerButton} onClick={() => setDialog('invite')}>
              Invite creator
            </Button>
            <Button variant="primary" arrow className={styles.headerButton} onClick={() => setDialog('client')}>
              Add brand client
            </Button>
          </>
        }
      />
      {agency.saveFailed ? (
        <Banner title="Not saved.">This browser refused to store your changes; they last until you leave the page.</Banner>
      ) : null}

      <section id="clients" className={styles.clients} aria-labelledby="agency-clients-title">
        <h2 id="agency-clients-title" className="sr-only">
          Brand clients
        </h2>
        <ul className={styles.clientGrid}>
          {DEMO_AGENCY_CLIENTS.map((c) => (
            <li key={c.id} className={styles.client}>
              <Eyebrow>{c.category}</Eyebrow>
              <h3 className={styles.clientName}>
                <Link href={withWorkspace('/brand', c.id)} className={styles.clientLink}>
                  {c.name}
                  <span className="sr-only"> — open the brand workspace</span>
                </Link>
              </h3>
              <div className={styles.clientMeta}>
                <span>Spend {formatINRCompactFromMinor(c.spendMinor)}</span>
                <span>{formatCount(c.creators)} creators</span>
              </div>
            </li>
          ))}
          {agency.clients.map((c) => (
            <li key={c.id} className={styles.client}>
              <div className={styles.pendingEyebrow}>
                <Eyebrow>{c.category}</Eyebrow>
                <Tag variant="outline">Pending · demo</Tag>
              </div>
              <h3 className={styles.clientName}>{c.name}</h3>
              <div className={styles.clientMeta}>
                <span className={styles.muted}>No invitation sent · {c.email}</span>
                <Button
                  size="xs"
                  variant="ghost"
                  className={styles.remove}
                  onClick={() => {
                    agency.removeClient(c.id);
                    setAnnouncement(`Removed ${c.name}.`);
                  }}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section id="roster" className={styles.roster} aria-labelledby="agency-roster-title">
        <Eyebrow as="h2" id="agency-roster-title" className={styles.sectionLabel}>
          Roster
        </Eyebrow>
        <ResponsiveTable
          caption={`Roster, earnings in ${DEMO_AGENCY_PERIOD.month}`}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.name}
          phoneRow={(r) => (
            <StackRow
              title={r.name}
              aside={shareCell(r)}
              meta={`${formatCountCompact(r.reach)} reach · ${formatCount(r.liveOffers)} live offers · ${formatINRFromMinor(r.earnedMinor)} earned in ${month}`}
            />
          )}
        />

        <form className={styles.shareForm} onSubmit={(e) => e.preventDefault()}>
          <Field
            label="Agency share"
            labelSuffix="(%)"
            error={shareError}
            hint={`${AGENCY_SHARE_MIN_PCT}–${AGENCY_SHARE_MAX_PCT}%, applied to every creator on the roster; kept in this browser (demo).`}
          >
            <div className={styles.shareRow}>
              <Input
                compact
                inputMode="numeric"
                autoComplete="off"
                className={styles.shareInput}
                value={shareInput ?? String(pct)}
                disabled={!agency.ready}
                onChange={(e) => onShareChange(e.target.value)}
                onBlur={() => {
                  if (!shareError) setShareInput(null);
                }}
              />
              <span className={styles.shareTotal}>
                <strong>{agency.ready ? formatINRFromMinor(total) : '—'}</strong> of these creators’{' '}
                {DEMO_AGENCY_PERIOD.month} earnings
              </span>
            </div>
          </Field>
        </form>

        {agency.invites.length > 0 ? (
          <div className={styles.invites}>
            <Eyebrow as="h3" className={styles.sectionLabel}>
              Invited · demo
            </Eyebrow>
            <ul className={styles.inviteList}>
              {agency.invites.map((i) => (
                <li key={i.id} className={styles.invite}>
                  <span className={styles.inviteName}>{i.name}</span>
                  <span className={styles.muted}>
                    {PLATFORM_NAME[i.platform]} · {i.handle} · no email sent
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    className={styles.remove}
                    onClick={() => {
                      agency.removeInvite(i.id);
                      setAnnouncement(`Removed the invite for ${i.name}.`);
                    }}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <InviteCreatorDialog
        open={dialog === 'invite'}
        onClose={() => setDialog(null)}
        onSave={(invite) => {
          agency.addInvite(invite);
          setAnnouncement(`Invite saved for ${invite.name}. No email was sent.`);
        }}
      />
      <AddClientDialog
        open={dialog === 'client'}
        onClose={() => setDialog(null)}
        onSave={(client) => {
          agency.addClient(client);
          setAnnouncement(`${client.name} added as a pending client. No invitation was sent.`);
        }}
      />
    </>
  );
}
