import type * as ynab from 'ynab';
import currency from 'currency.js';
import { subDays, subMonths, differenceInDays, parseISO } from 'date-fns';
import { median, std, mean, sum, min, max } from 'mathjs';

// ---------------------------------------------------------------------------
// Name resolvers
// ---------------------------------------------------------------------------

export async function resolveAccountId(
  ynabAPI: ynab.API,
  budgetId: string,
  name: string
): Promise<string | null> {
  const response = await ynabAPI.accounts.getAccounts(budgetId);
  const accounts = response.data.accounts;
  const match = accounts.find(a => !a.deleted && !a.closed && a.name === name);
  return match?.id ?? null;
}

export async function resolveCategoryId(
  ynabAPI: ynab.API,
  budgetId: string,
  name: string
): Promise<string | null> {
  const response = await ynabAPI.categories.getCategories(budgetId);
  const categories = response.data.category_groups.flatMap(g => g.categories);
  const match = categories.find(c => !c.deleted && !c.hidden && c.name === name);
  return match?.id ?? null;
}

export async function resolvePayeeId(
  ynabAPI: ynab.API,
  budgetId: string,
  name: string
): Promise<string | null> {
  const response = await ynabAPI.payees.getPayees(budgetId);
  const payees = response.data.payees;
  const match = payees.find(p => !p.deleted && p.name === name);
  return match?.id ?? null;
}

// ---------------------------------------------------------------------------
// Split validation
// ---------------------------------------------------------------------------

export interface SplitInput {
  category: string;
  amount: currency | null;
  memo?: string;
}

export interface ValidateSplitsResult {
  subtransactions: ynab.SaveSubTransaction[];
  errors: string[];
}

export async function validateAndResolveSplits(
  ynabAPI: ynab.API,
  budgetId: string,
  totalAmount: currency,
  splits: SplitInput[]
): Promise<ValidateSplitsResult> {
  const errors: string[] = [];

  if (splits.length < 2) {
    errors.push('A split transaction requires at least 2 splits.');
    return { subtransactions: [], errors };
  }

  const nullCount = splits.filter(s => s.amount === null).length;
  if (nullCount > 1) {
    errors.push('Only one split may have a null amount (calculated from remainder).');
  }

  const resolvedCategories: ({ id: string; name: string } | null)[] = [];
  for (const split of splits) {
    const id = await resolveCategoryId(ynabAPI, budgetId, split.category);
    if (!id) {
      errors.push(`Category "${split.category}" not found.`);
      resolvedCategories.push(null);
    }
    else {
      resolvedCategories.push({ id, name: split.category });
    }
  }

  if (errors.length > 0) {
    return { subtransactions: [], errors };
  }

  let explicitSum = currency(0);
  for (const split of splits) {
    if (split.amount !== null) {
      explicitSum = explicitSum.add(split.amount);
    }
  }

  const remainder = totalAmount.subtract(explicitSum);

  if (nullCount === 0) {
    if (explicitSum.value !== totalAmount.value) {
      errors.push(
        `Split amounts sum to ${formatAmount(explicitSum)} but total is ${formatAmount(totalAmount)}.`
      );
    }
  }
  else if (nullCount === 1) {
    if (remainder.value === 0) {
      errors.push(
        'The calculated remainder is 0. Please provide explicit amounts for all splits.'
      );
    }
  }

  if (errors.length > 0) {
    return { subtransactions: [], errors };
  }

  const subtransactions: ynab.SaveSubTransaction[] = [];
  for (let i = 0; i < splits.length; i++) {
    const split = splits[i];
    const category = resolvedCategories[i]!;
    const amountDollars = split.amount === null ? remainder : split.amount;
    const amountMilliunits = Math.round(amountDollars.value * 1000);

    subtransactions.push({
      amount: amountMilliunits,
      category_id: category.id,
      memo: split.memo ?? null
    });
  }

  return { subtransactions, errors };
}

// ---------------------------------------------------------------------------
// Money formatting
// ---------------------------------------------------------------------------

export function formatMilliunits(milliunits: number): string {
  return currency(milliunits / 1000).format();
}

export function formatAmount(c: currency): string {
  return currency(c.value).format();
}

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

export function getDefaultSinceDate(): string {
  return subDays(new Date(), 30).toISOString().split('T')[0];
}

export function getDefaultPayeeSinceDate(): string {
  return subMonths(new Date(), 6).toISOString().split('T')[0];
}

export function daysBetween(a: string, b: string): number {
  return differenceInDays(parseISO(b), parseISO(a));
}

export function calculateFrequencyDays(dates: string[]): number | null {
  if (dates.length <= 1) return null;
  const sorted = [...dates].sort();
  let totalGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    totalGap += daysBetween(sorted[i - 1], sorted[i]);
  }
  return totalGap / (sorted.length - 1);
}

// ---------------------------------------------------------------------------
// Payee history statistics
// ---------------------------------------------------------------------------

export function mostCommonCategory(categories: (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const cat of categories) {
    if (!cat) continue;
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [cat, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = cat;
    }
  }
  return best;
}

export interface PayeeStats {
  transactionCount: number;
  totalSpent: number;
  averageAmount: number;
  medianAmount: number;
  minAmount: number;
  maxAmount: number;
  stdDeviation: number;
  firstTransactionDate: string;
  lastTransactionDate: string;
  frequencyDays: number | null;
  mostCommonCategory: string | null;
  refundCount: number;
  recentTransactions: { date: string; amount: number; category_name: string | null }[];
}

export function buildPayeeStats(
  transactions: ynab.HybridTransaction[]
): PayeeStats {
  const outflows = transactions.filter(t => t.amount < 0);
  const inflows = transactions.filter(t => t.amount > 0);

  const outflowAmounts = outflows.map(t => Math.abs(t.amount));
  const outflowDates = outflows.map(t => t.date);

  const sortedByDate = [...outflows].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const transactionCount = outflows.length;
  const totalSpent = sum(outflowAmounts) as number;
  const averageAmount = transactionCount > 0 ? (mean(outflowAmounts) as number) : 0;
  const medianAmount = outflowAmounts.length > 0 ? (median(outflowAmounts) as number) : 0;
  const minAmount = transactionCount > 0 ? (min(outflowAmounts) as number) : 0;
  const maxAmount = transactionCount > 0 ? (max(outflowAmounts) as number) : 0;
  const stdDeviation
    = outflowAmounts.length > 1 ? (std(outflowAmounts, 'uncorrected') as number) : 0;

  const allDates = [...outflowDates, ...inflows.map(t => t.date)].sort();
  const firstTransactionDate = allDates[0] ?? '';
  const lastTransactionDate = allDates[allDates.length - 1] ?? '';

  const frequencyDays = calculateFrequencyDays(outflowDates);
  const category = mostCommonCategory(outflows.map(t => t.category_name));

  const recentTransactions = sortedByDate.slice(0, 3).map(t => ({
    date: t.date,
    amount: t.amount,
    category_name: t.category_name ?? null
  }));

  return {
    transactionCount,
    totalSpent,
    averageAmount,
    medianAmount,
    minAmount,
    maxAmount,
    stdDeviation,
    firstTransactionDate,
    lastTransactionDate,
    frequencyDays,
    mostCommonCategory: category,
    refundCount: inflows.length,
    recentTransactions
  };
}

// ---------------------------------------------------------------------------
// YNAB error helpers
// ---------------------------------------------------------------------------

const YNAB_ERROR_MESSAGES: Record<string, string> = {
  401: 'Unauthorized: Invalid or expired access token',
  404: 'Budget not found: Verify the budget ID',
  429: 'Rate limit exceeded: YNAB allows 200 requests per hour. Please wait and try again.',
  500: 'YNAB service error: Please try again later',
  503: 'YNAB service unavailable: Temporary outage, please try again later'
};

export function getYnabErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'error' in error) {
    const ynabError = (error as { error: { id: string; name: string; detail: string } }).error;
    return (
      YNAB_ERROR_MESSAGES[ynabError.id]
      || `YNAB API Error (${ynabError.id}): ${ynabError.detail}`
    );
  }
  return `Unknown error: ${String(error)}`;
}

export function isYnabNotFoundError(error: unknown): boolean {
  return (
    error !== null
    && error !== undefined
    && typeof error === 'object'
    && 'error' in error
    && typeof (error as { error: { id: string } }).error.id === 'string'
    && (error as { error: { id: string } }).error.id === '404'
  );
}
