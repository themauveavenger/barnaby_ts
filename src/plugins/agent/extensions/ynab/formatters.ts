import type * as ynab from 'ynab';
import { formatMilliunits, buildPayeeStats, daysBetween } from './utils.js';

export function formatTransactionLine(t: ynab.TransactionDetail): string {
  const amount = formatMilliunits(t.amount);
  const payee = t.payee_name ?? '(none)';
  const category = t.category_name ?? '(none)';
  const approved = t.approved ? 'approved' : 'unapproved';
  return `- ${t.date} | ${amount} | ${payee} | ${category} | ${t.account_name} | ${t.cleared} | ${approved}`;
}

export function formatTransactionsResponse(
  budgetId: string,
  sinceDate: string,
  unapproved: boolean | undefined,
  uncleared: boolean | undefined,
  transactions: ynab.TransactionDetail[]
): string {
  const lines: string[] = [
    `Returned ${transactions.length} transactions from YNAB budget ${budgetId} since ${sinceDate}.`
  ];

  const filters: string[] = [];
  if (unapproved !== undefined) filters.push(`Unapproved filter: ${unapproved}`);
  if (uncleared !== undefined) filters.push(`Uncleared filter: ${uncleared}`);
  if (filters.length > 0) {
    lines.push(filters.join(' | '));
  }

  lines.push('', 'Transactions:');
  for (const t of transactions) {
    lines.push(formatTransactionLine(t));
  }

  return lines.join('\n');
}

export function formatPayeeHistoryResponse(
  payeeName: string,
  sinceDate: string,
  stats: ReturnType<typeof buildPayeeStats>
): string {
  const today = new Date().toISOString().split('T')[0];
  const days = daysBetween(sinceDate, today);

  const lines: string[] = [
    `Payee history for "${payeeName}" over the last ${days} days.`,
    `Transactions: ${stats.transactionCount} | Total spent: ${formatMilliunits(stats.totalSpent)} | Refunds: ${stats.refundCount}`,
    `Average: ${formatMilliunits(stats.averageAmount)} | Median: ${formatMilliunits(stats.medianAmount)} | Min: ${formatMilliunits(stats.minAmount)} | Max: ${formatMilliunits(stats.maxAmount)}`
  ];

  const frequency
    = stats.frequencyDays !== null
      ? `~${stats.frequencyDays.toFixed(1)} days between visits`
      : 'N/A (insufficient data)';
  lines.push(`Std deviation: ${formatMilliunits(stats.stdDeviation)} | Frequency: ${frequency}`);
  lines.push(`Most common category: ${stats.mostCommonCategory ?? 'N/A'}`);

  lines.push('', 'Recent transactions:');
  for (const t of stats.recentTransactions) {
    lines.push(`- ${t.date} | ${formatMilliunits(t.amount)} | ${t.category_name ?? '(none)'}`);
  }

  return lines.join('\n');
}

export function formatCreateTransactionResponse(
  account: string,
  date: string,
  amount: string,
  payee: string,
  category: string | null,
  memo: string | null
): string {
  const lines = [`Created transaction in ${account}.`];
  const categoryText = category ?? '(none)';
  const memoText = memo ? ` | Memo: ${memo}` : '';
  lines.push(`- Date: ${date} | Amount: ${amount} | Payee: ${payee} | Category: ${categoryText}${memoText}`);
  return lines.join('\n');
}

export function formatCreateTransferResponse(
  fromAccount: string,
  toAccount: string,
  date: string,
  amount: string
): string {
  const lines = [
    `Created transfer from ${fromAccount} to ${toAccount}.`,
    `- Date: ${date} | Amount: ${amount} | Transfer to ${toAccount}`
  ];
  return lines.join('\n');
}

export interface SplitLine {
  category: string;
  amount: string;
}

export function formatCreateSplitResponse(
  account: string,
  date: string,
  amount: string,
  payee: string,
  splits: SplitLine[]
): string {
  const lines = [
    `Created split transaction in ${account} across ${splits.length} categories.`,
    `- Date: ${date} | Amount: ${amount} | Payee: ${payee}`
  ];
  for (const split of splits) {
    lines.push(`  - ${split.category}: ${split.amount}`);
  }
  return lines.join('\n');
}

export function formatSplitTransactionResponse(
  transactionId: string,
  splits: SplitLine[]
): string {
  const lines = [`Split transaction ${transactionId} into ${splits.length} categories.`];
  for (const split of splits) {
    lines.push(`- ${split.category}: ${split.amount}`);
  }
  return lines.join('\n');
}

export function formatApproveTransactionResponse(
  transactionId: string,
  date: string,
  amount: string,
  payee: string,
  category: string | null,
  cleared: string
): string {
  const categoryText = category ?? '(none)';
  const clearedText = cleared === 'uncleared' ? 'no' : 'yes';
  return `Approved transaction ${transactionId}.\n- Date: ${date} | Amount: ${amount} | Payee: ${payee} | Category: ${categoryText} | Cleared: ${clearedText}`;
}

export function formatAlreadyApprovedResponse(
  transactionId: string,
  date: string,
  amount: string,
  payee: string,
  category: string | null,
  cleared: string
): string {
  const categoryText = category ?? '(none)';
  const clearedText = cleared === 'uncleared' ? 'no' : 'yes';
  return `Transaction ${transactionId} was already approved. No changes needed.\n- Date: ${date} | Amount: ${amount} | Payee: ${payee} | Category: ${categoryText} | Cleared: ${clearedText}`;
}

export function formatDeleteTransactionResponse(
  transactionId: string,
  date: string,
  amount: string,
  payee: string,
  category: string | null,
  memo: string | null
): string {
  const categoryText = category ?? '(none)';
  const memoText = memo ? ` | Memo: ${memo}` : '';
  return `Deleted transaction ${transactionId}.\n- Date: ${date} | Amount: ${amount} | Payee: ${payee} | Category: ${categoryText}${memoText}`;
}

export function formatFlagTransactionResponse(
  transactionId: string,
  flagColor: string | null,
  memo: string | null
): string {
  const memoText = memo ? `\n- Memo: ${memo}` : '';
  if (!flagColor) {
    return `Cleared flag from transaction ${transactionId}.${memoText}`;
  }
  return `Flagged transaction ${transactionId} with ${flagColor} flag.${memoText}`;
}

export function formatAlreadyFlaggedResponse(
  transactionId: string,
  flagColor: string | null
): string {
  if (!flagColor) {
    return `Transaction ${transactionId} already has no flag. No changes needed.`;
  }
  return `Transaction ${transactionId} already has the ${flagColor} flag. No changes needed.`;
}
