import type { Metadata } from 'next';
import { Statements } from './Statements';

export const metadata: Metadata = { title: 'Statements' };

/** Ledger drilldown (was /portal/statements): TEST demo data until a statement endpoint exists. */
export default function AppPayoutsStatementsPage() {
  return <Statements />;
}
