import { z } from 'zod';

export const chartTypes = [
  'debt_waterfall',
  'payment_stack',
  'interest_trap_timeline',
  'statement_breakdown',
  'fee_explosion',
  'before_after_cashflow',
] as const;

export type ChartType = (typeof chartTypes)[number];

export const chartValueSchema = z.object({
  label: z.string().min(1).max(44),
  amount: z.number(),
  note: z.string().max(80).optional(),
});

export const chartPayloadSchema = z.object({
  chartType: z.enum(chartTypes).default('debt_waterfall'),
  title: z.string().min(1).max(92),
  subtitle: z.string().max(140).optional(),
  values: z.array(chartValueSchema).min(1).max(8),
  duration: z.number().min(2).max(12).default(5),
  sceneId: z.string().max(80).optional(),
  voiceoverBeat: z.string().max(320).optional(),
  style: z.string().max(80).default('bills_to_wealth_hmw'),
  emphasis: z.string().max(80).optional(),
});

export type ChartPayload = z.infer<typeof chartPayloadSchema>;

export const defaultPayload: ChartPayload = {
  chartType: 'debt_waterfall',
  title: 'The Real Cost Of A $450 Payment',
  subtitle: 'One monthly number hides the rest of the trap.',
  values: [
    { label: 'Car payment', amount: 450 },
    { label: 'Insurance', amount: 180 },
    { label: 'Gas', amount: 220 },
    { label: 'Maintenance', amount: 95 },
    { label: 'Fees', amount: 60 },
  ],
  duration: 5,
  style: 'bills_to_wealth_hmw',
  emphasis: 'Real cost',
};

export const chartTypeDescriptions: Record<ChartType, string> = {
  debt_waterfall: 'Animated cost waterfall for showing how a small payment expands into the real monthly burden.',
  payment_stack: 'Stacked animated bars for comparing payment components, income pressure, or debt categories.',
  interest_trap_timeline: 'Animated timeline/curve for showing how fees or interest compound over time.',
  statement_breakdown: 'Statement-style callout for APR, minimum payment, due date, and hidden fees.',
  fee_explosion: 'Big number reveal with fee chips for penalties, overdrafts, late payments, and add-ons.',
  before_after_cashflow: 'Before/after money flow for showing what changes after a decision.',
};
