import { chartTypes, type ChartPayload, type ChartType } from './chartTypes.js';
import { validateVisualPlan, type VisualPlanScene } from './planQa.js';

export type BrollClip = {
  clip_id?: string;
  id?: string;
  url?: string;
  u?: string;
  direct_url?: string;
  download_url?: string;
  category?: string;
  c?: string;
  tags?: string[];
  source_filename?: string;
  filename?: string;
  drive_file_id?: string;
  description?: string;
  desc?: string;
  intent?: string;
  exact?: string[];
  boost?: string[];
  mood?: string | null;
  shot_type?: string | null;
  shot?: string | null;
  setting?: string | null;
  people_count?: number | null;
  has_visible_text?: boolean | null;
  contains_foreign_currency?: boolean | null;
  contains_foreign_setting?: boolean | null;
  quality_score?: number | null;
  q?: number | null;
  thumbnail_url?: string;
  th?: string;
};

export type VideoPlanSceneInput = {
  sceneIndex?: number;
  sceneId?: string;
  text?: string;
  narration?: string;
  voiceoverText?: string;
  voiceoverBeat?: string;
  duration?: number;
  approvedStats?: unknown[];
  visualIntent?: string;
  candidates?: BrollClip[];
};

export type VideoPlanOptions = {
  targetChartCount?: number;
  maxGenericScreenClips?: number;
  minBrollScore?: number;
  minRescueBrollScore?: number;
  maxClipRepeats?: number;
};

export type PlannedVisualScene = {
  sceneIndex: number;
  sceneId: string;
  narration: string;
  duration: number;
  visualType: 'broll' | 'chart' | 'text';
  visualIntent: string;
  brollQuery?: string;
  selectedClip?: SelectedBrollClip;
  chartPayload?: ChartPayload;
  chartType?: ChartType;
  fallbackTitle?: string;
  fallbackKicker?: string;
  fallbackText?: string;
  suppressCaptions?: boolean;
  visualFingerprint: string;
  relevanceScore: number;
  qa: {
    duplicate: boolean;
    reason: string;
    warnings: string[];
  };
};

export type SelectedBrollClip = {
  clipId: string;
  url: string;
  directUrl?: string;
  thumbnailUrl?: string;
  category: string;
  tags: string[];
  description: string;
  qualityScore: number;
  rawQualityScore?: number | null;
  score: number;
  driveFileId?: string;
  sourceFilename?: string;
};

type IntentProfile = {
  label: string;
  categories: string[];
  keywords: string[];
  desiredTerms: string[];
  forbiddenTerms?: string[];
  chartTypes: ChartType[];
};

type SceneIntent = {
  label: string;
  query: string;
  categories: string[];
  desiredTerms: string[];
  forbiddenTerms: string[];
  avoidGenericScreen: boolean;
  chartTypes: ChartType[];
  highSignalTokens: string[];
};

const QUALITY_FALLBACK = 6.5;
const MIN_BROLL_SCORE = 14;
const MIN_RESCUE_BROLL_SCORE = 9;
const DEFAULT_TARGET_CHARTS = 5;

const backendLabelReplacements: Record<string, string> = {
  budget_pressure: 'monthly budget pressure',
  generic_debt: 'debt pressure',
  generic_savings: 'savings buffer',
  generic_credit: 'credit pressure',
  generic_budget: 'monthly budget',
  visual_intent: '',
  broll_query: '',
  chart_payload: '',
};

const stopWords = new Set([
  'about', 'after', 'again', 'also', 'because', 'before', 'being', 'between', 'could',
  'every', 'feeling', 'first', 'from', 'gave', 'gets', 'going', 'have', 'here', 'into',
  'just', 'like', 'more', 'most', 'that', 'their', 'them', 'then', 'there', 'they',
  'this', 'those', 'through', 'what', 'when', 'where', 'which', 'while', 'with', 'would',
  'your', 'youre', 'you', 'and', 'are', 'but', 'can', 'did', 'for', 'had', 'has', 'not',
  'now', 'off', 'one', 'out', 'the', 'was', 'were',
]);

const intentProfiles: IntentProfile[] = [
  {
    label: 'overdraft fee and debit card decline',
    categories: ['02_savings_banking', '18_budgeting_bank_app', '01_debt_credit_cards', '13_grocery_shopping'],
    keywords: ['overdraft', 'fee', 'debit', 'declined', 'pending', 'gas', 'pump', 'checkout', 'balance', 'alert', 'banking'],
    desiredTerms: ['debit card', 'bank app', 'balance', 'overdraft fee', 'pending charge', 'checkout', 'receipt', 'low balance alert'],
    forbiddenTerms: ['repair', 'mechanic', 'tire', 'wheel', 'hood', 'jack', 'oil', 'garage', 'tools'],
    chartTypes: ['fee_explosion', 'statement_breakdown', 'before_after_cashflow'],
  },
  {
    label: 'dealership paperwork and loan signing',
    categories: ['01_debt_credit_cards', '04_budgeting', '07_income_paycheck', '14_car_repair'],
    keywords: ['dealership', 'salesperson', 'paperwork', 'sign', 'signed', 'contract', 'loan', 'keys', 'desk', 'financing'],
    desiredTerms: ['paperwork', 'contract', 'documents', 'signature', 'pen', 'desk', 'loan', 'financing', 'salesperson'],
    forbiddenTerms: ['repair', 'mechanic', 'tire', 'wheel', 'hood', 'jack', 'oil', 'garage', 'tools'],
    chartTypes: ['statement_breakdown', 'payment_stack', 'debt_waterfall'],
  },
  {
    label: 'credit card debt statement',
    categories: ['01_debt_credit_cards', '04_budgeting', '08_credit_score'],
    keywords: ['credit', 'card', 'apr', 'interest', 'minimum', 'statement', 'balance', 'late', 'debt'],
    desiredTerms: ['credit card', 'statement', 'bill', 'balance', 'payment', 'debt', 'minimum', 'APR'],
    chartTypes: ['statement_breakdown', 'interest_trap_timeline', 'fee_explosion'],
  },
  {
    label: 'budgeting and monthly bills',
    categories: ['04_budgeting', '18_budgeting_bank_app', '02_savings_banking'],
    keywords: ['budget', 'bill', 'bills', 'monthly', 'rent', 'payment', 'expense', 'spreadsheet'],
    desiredTerms: ['budget', 'bills', 'calculator', 'notebook', 'receipt', 'monthly payment', 'expense'],
    chartTypes: ['payment_stack', 'before_after_cashflow', 'debt_waterfall'],
  },
  {
    label: 'banking and savings',
    categories: ['02_savings_banking', '18_budgeting_bank_app', '06_relief_success'],
    keywords: ['saving', 'savings', 'bank', 'checking', 'account', 'deposit', 'transfer', 'balance'],
    desiredTerms: ['bank', 'savings', 'account', 'deposit', 'transfer', 'balance', 'cash'],
    chartTypes: ['before_after_cashflow', 'payment_stack'],
  },
  {
    label: 'stress and financial worry',
    categories: ['05_stress_worry', '04_budgeting', '09_healthcare_bills'],
    keywords: ['stress', 'worried', 'panic', 'anxiety', 'overwhelmed', 'late', 'behind', 'barely'],
    desiredTerms: ['worried person', 'bills', 'kitchen table', 'stress', 'phone call', 'mail'],
    chartTypes: ['fee_explosion', 'statement_breakdown'],
  },
  {
    label: 'grocery inflation',
    categories: ['13_grocery_shopping', '19_inflation_expenses', '04_budgeting'],
    keywords: ['grocery', 'groceries', 'food', 'supermarket', 'prices', 'inflation', 'receipt'],
    desiredTerms: ['grocery', 'supermarket', 'receipt', 'price tag', 'shopping cart', 'produce'],
    chartTypes: ['payment_stack', 'debt_waterfall'],
  },
  {
    label: 'housing rent mortgage',
    categories: ['12_housing_mortgage', '04_budgeting', '05_stress_worry'],
    keywords: ['rent', 'mortgage', 'landlord', 'house', 'home', 'apartment', 'housing'],
    desiredTerms: ['house', 'apartment', 'rent', 'mortgage', 'keys', 'mailbox', 'front door'],
    chartTypes: ['before_after_cashflow', 'payment_stack'],
  },
  {
    label: 'income and paycheck',
    categories: ['07_income_paycheck', '21_people_at_work', '02_savings_banking'],
    keywords: ['paycheck', 'income', 'salary', 'wage', 'job', 'work', 'employer'],
    desiredTerms: ['paycheck', 'work', 'office', 'time clock', 'deposit', 'paystub'],
    chartTypes: ['before_after_cashflow', 'payment_stack'],
  },
  {
    label: 'investing and wealth building',
    categories: ['10_investing_wealth', '20_investing_stock_market', '03_retirement'],
    keywords: ['invest', 'investing', 'stock', 'portfolio', 'wealth', 'retirement', '401k', 'compound'],
    desiredTerms: ['portfolio', 'chart', 'stock market', 'retirement', 'investment', 'financial plan'],
    chartTypes: ['interest_trap_timeline', 'before_after_cashflow'],
  },
  {
    label: 'healthcare and medical bills',
    categories: ['09_healthcare_bills', '15_medical_copay', '04_budgeting'],
    keywords: ['medical', 'doctor', 'hospital', 'copay', 'healthcare', 'insurance', 'pharmacy'],
    desiredTerms: ['medical bill', 'doctor', 'pharmacy', 'hospital', 'insurance', 'copay'],
    chartTypes: ['statement_breakdown', 'fee_explosion'],
  },
  {
    label: 'subscriptions and app charges',
    categories: ['17_subscriptions_apps', '18_budgeting_bank_app', '04_budgeting'],
    keywords: ['subscription', 'subscriptions', 'app', 'apps', 'trial', 'renewal', 'streaming'],
    desiredTerms: ['phone app', 'subscription', 'bank app', 'calendar', 'recurring charge'],
    chartTypes: ['fee_explosion', 'payment_stack'],
  },
  {
    label: 'car repair and transportation costs',
    categories: ['14_car_repair', '19_inflation_expenses', '04_budgeting'],
    keywords: ['car', 'vehicle', 'auto', 'mechanic', 'repair', 'maintenance', 'gas', 'insurance'],
    desiredTerms: ['car', 'vehicle', 'mechanic', 'repair', 'gas pump', 'insurance', 'maintenance'],
    chartTypes: ['debt_waterfall', 'payment_stack'],
  },
];

const normalizeText = (value = '') =>
  value
    .toLowerCase()
    .replace(/[$,]/g, ' ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (value = '') =>
  normalizeText(value)
    .split(' ')
    .filter((token) => token.length > 2 && !stopWords.has(token));

const unique = <T>(items: T[]) => Array.from(new Set(items));

const firstText = (...values: Array<string | null | undefined>) =>
  values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() || '';

const titleCase = (value = '') =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

export function hasInternalVisibleLabel(value = '') {
  const normalized = value.toLowerCase();
  if (/\b(?:budget_pressure|generic_debt|generic_savings|generic_credit|generic_budget|visual_intent|broll_query|chart_payload)\b/.test(normalized)) {
    return true;
  }
  if (/\b[a-z]+_[a-z0-9_]+\b/.test(value)) return true;
  if (/\s+#\d+\b/.test(value)) return true;
  return false;
}

export function cleanVisibleText(value = '', fallback = '') {
  let cleaned = String(value || '');
  for (const [token, replacement] of Object.entries(backendLabelReplacements)) {
    cleaned = cleaned.replace(new RegExp(`\\b${token}\\b`, 'gi'), replacement);
  }
  cleaned = cleaned
    .replace(/\s+#\d+\b/g, '')
    .replace(/\b([a-z]+(?:_[a-z0-9]+)+)\b/g, (_match, token: string) => titleCase(token))
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function isOnlyBackendHint(value = '') {
  const normalized = value.trim();
  if (!normalized) return false;
  if (backendLabelReplacements[normalized.toLowerCase()]) return true;
  return /^[a-z0-9_ -]+#?\d*$/i.test(normalized) && hasInternalVisibleLabel(normalized);
}

function clipUrl(clip: BrollClip) {
  return firstText(clip.url, clip.u, clip.direct_url, clip.download_url);
}

function clipCategory(clip: BrollClip) {
  return firstText(clip.category, clip.c) || 'uncategorized';
}

function clipDescription(clip: BrollClip) {
  return firstText(clip.description, clip.desc);
}

function clipSourceFilename(clip: BrollClip) {
  return firstText(clip.source_filename, clip.filename);
}

function clipThumbnailUrl(clip: BrollClip) {
  return firstText(clip.thumbnail_url, clip.th);
}

function clipTags(clip: BrollClip) {
  const baseTags = Array.isArray(clip.tags) ? clip.tags : [];
  return unique([
    ...baseTags,
    ...(Array.isArray(clip.exact) ? clip.exact : []),
    ...(Array.isArray(clip.boost) ? clip.boost : []),
    clip.intent,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0));
}

function rawQualityFor(clip: BrollClip) {
  if (typeof clip.quality_score === 'number' && Number.isFinite(clip.quality_score)) {
    return clip.quality_score;
  }
  if (typeof clip.q === 'number' && Number.isFinite(clip.q)) {
    return clip.q;
  }
  return null;
}

const safeText = (scene: VideoPlanSceneInput) => {
  const visible = [
    scene.narration,
    scene.voiceoverBeat,
    scene.voiceoverText,
    scene.text,
    isOnlyBackendHint(scene.visualIntent || '') ? '' : scene.visualIntent,
  ]
    .filter(Boolean)
    .map((value) => cleanVisibleText(String(value)))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);

  if (visible) return visible;
  return cleanVisibleText(scene.visualIntent || '', 'Money decision');
};

function countMatches(text: string, terms: string[]) {
  const normalized = normalizeText(text);
  return terms.reduce((score, term) => {
    const cleanTerm = normalizeText(term);
    if (!cleanTerm) return score;
    if (normalized.includes(cleanTerm)) return score + Math.max(1, cleanTerm.split(' ').length);
    return score;
  }, 0);
}

function clipText(clip: BrollClip) {
  return [
    clipCategory(clip),
    clipDescription(clip),
    clip.setting,
    clip.mood,
    clip.shot_type,
    clip.shot,
    clipSourceFilename(clip),
    ...clipTags(clip),
  ]
    .filter(Boolean)
    .join(' ');
}

function clipIdentity(clip: BrollClip) {
  return String(clip.clip_id || clip.id || clip.drive_file_id || clipUrl(clip) || '').trim();
}

export function driveDirectUrl(clip: BrollClip) {
  if (clip.direct_url || clip.download_url) return clip.direct_url || clip.download_url;
  const url = clipUrl(clip);
  const id = clip.drive_file_id || url.match(/\/d\/([^/]+)/)?.[1] || url.match(/[?&]id=([^&]+)/)?.[1];
  if (!id) return url;
  return `https://drive.google.com/uc?id=${encodeURIComponent(id)}&export=download`;
}

export function inferSceneIntent(scene: VideoPlanSceneInput): SceneIntent {
  const text = safeText(scene);
  const normalized = normalizeText(text);
  const tokens = tokenize(text);
  const scored = intentProfiles
    .map((profile) => ({
      profile,
      score:
        countMatches(normalized, profile.keywords) * 4 +
        countMatches(normalized, profile.desiredTerms) * 2,
    }))
    .sort((a, b) => b.score - a.score);

  const winner = scored[0]?.score > 0 ? scored[0].profile : intentProfiles[2];
  const isPaperwork =
    /\b(sign|signed|signing|paperwork|contract|documents?|loan officer|finance manager|dealership)\b/i.test(text) &&
    /\b(car|auto|vehicle|dealership|loan|keys)\b/i.test(text);

  const profile = isPaperwork ? intentProfiles[0] : winner;
  const highSignalTokens = unique(tokens.filter((token) => token.length > 3)).slice(0, 10);
  const desiredTerms = unique([...profile.desiredTerms, ...highSignalTokens.slice(0, 6)]);
  const forbiddenTerms = unique(profile.forbiddenTerms || []);
  const query = unique([...profile.desiredTerms.slice(0, 5), ...highSignalTokens.slice(0, 4)]).join(' ');

  return {
    label: profile.label,
    query,
    categories: profile.categories,
    desiredTerms,
    forbiddenTerms,
    avoidGenericScreen: !/\b(app|screen|website|dashboard|online banking)\b/i.test(text),
    chartTypes: profile.chartTypes,
    highSignalTokens,
  };
}

function qualityFor(clip: BrollClip) {
  return rawQualityFor(clip) ?? QUALITY_FALLBACK;
}

function isGenericScreenClip(clip: BrollClip) {
  return /\b(laptop|computer|screen|monitor|keyboard|typing|website|scrolling)\b/i.test(clipText(clip));
}

function scoreClip(clip: BrollClip, intent: SceneIntent, usedFingerprints: Set<string>) {
  const text = clipText(clip);
  const normalized = normalizeText(text);
  const identity = clipIdentity(clip);
  const url = clipUrl(clip);
  const category = clipCategory(clip);
  const fingerprint = identity || normalizeText(`${category}:${url}`);
  if (!identity || !url) return { score: -999, warnings: ['missing_url_or_identity'] };
  if (usedFingerprints.has(fingerprint)) return { score: -999, warnings: ['duplicate_clip'] };

  let score = 0;
  const warnings: string[] = [];
  const quality = qualityFor(clip);
  score += quality;

  if (intent.categories.includes(String(category))) score += 12;
  score += countMatches(normalized, intent.desiredTerms) * 4;
  score += countMatches(normalized, intent.highSignalTokens) * 2;

  const forbiddenHits = countMatches(normalized, intent.forbiddenTerms);
  if (forbiddenHits) {
    score -= forbiddenHits * 12;
    warnings.push('forbidden_visual_terms');
  }

  if (clip.has_visible_text === true) {
    score -= 5;
    warnings.push('visible_text');
  }
  if (clip.contains_foreign_currency === true || clip.contains_foreign_setting === true) {
    score -= 10;
    warnings.push('foreign_context');
  }
  if (intent.avoidGenericScreen && isGenericScreenClip(clip)) {
    score -= 7;
    warnings.push('generic_screen_clip');
  }
  if (rawQualityFor(clip) == null) {
    score -= 0.75;
    warnings.push('missing_quality_score_used_fallback');
  }
  if (intent.label.includes('paperwork') && /\b(tire|wheel|mechanic|repair|jack|hood)\b/i.test(text)) {
    score -= 18;
    warnings.push('paperwork_scene_rejects_repair_visual');
  }

  return { score, warnings };
}

function selectBrollClip(
  clips: BrollClip[],
  intent: SceneIntent,
  usedFingerprints: Set<string>,
  minScore: number,
) {
  const ranked = clips
    .map((clip) => {
      const result = scoreClip(clip, intent, usedFingerprints);
      return { clip, score: result.score, warnings: result.warnings };
    })
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score);

  const selected = ranked[0];
  if (!selected) return undefined;

  const clip = selected.clip;
  const clipId = clipIdentity(clip);
  return {
    clipId,
    url: clipUrl(clip),
    directUrl: driveDirectUrl(clip),
    thumbnailUrl: clipThumbnailUrl(clip),
    category: clipCategory(clip),
    tags: clipTags(clip),
    description: clipDescription(clip),
    qualityScore: qualityFor(clip),
    rawQualityScore: rawQualityFor(clip),
    score: Number(selected.score.toFixed(2)),
    driveFileId: clip.drive_file_id,
    sourceFilename: clipSourceFilename(clip),
    warnings: selected.warnings,
  };
}

function conciseBeat(scene: VideoPlanSceneInput) {
  const text = safeText(scene);
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  return cleanVisibleText(firstSentence).slice(0, 140);
}

function hasNumbers(text: string) {
  return /(\$|\b\d+%|\bapr\b|\binterest\b|\bfee\b|\bpayment\b|\bmonthly\b|\bbalance\b)/i.test(text);
}

function chooseChartType(scene: VideoPlanSceneInput, intent: SceneIntent, previousChartType?: ChartType): ChartType {
  const text = safeText(scene);
  const preferred = [...intent.chartTypes];
  if (/\b(apr|interest|compound|years?|months?)\b/i.test(text)) preferred.unshift('interest_trap_timeline');
  if (/\b(statement|minimum|due date|balance)\b/i.test(text)) preferred.unshift('statement_breakdown');
  if (/\b(fee|late|overdraft|penalty|add on|addon)\b/i.test(text)) preferred.unshift('fee_explosion');
  if (/\b(before|after|instead|switch|save|savings)\b/i.test(text)) preferred.unshift('before_after_cashflow');
  if (/\b(monthly|payment|insurance|gas|rent|budget)\b/i.test(text)) preferred.unshift('payment_stack');

  const uniquePreferred = unique(preferred.filter((type) => chartTypes.includes(type)));
  return uniquePreferred.find((type) => type !== previousChartType) || uniquePreferred[0] || 'payment_stack';
}

function extractMoneyValues(text: string) {
  const matches = Array.from(text.matchAll(/\$?\b(\d{2,6})(?:,\d{3})?\b/g))
    .map((match) => Number(match[1].replace(/,/g, '')))
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, 5);
  return matches.length ? matches : [];
}

function chartValuesFor(scene: VideoPlanSceneInput, chartType: ChartType) {
  const text = safeText(scene);
  const values = extractMoneyValues(text);
  if (chartType === 'interest_trap_timeline') {
    const base = values[0] || 450;
    return [
      { label: 'Month 1', amount: base },
      { label: 'Year 1', amount: Math.round(base * 1.22) },
      { label: 'Year 3', amount: Math.round(base * 1.62) },
      { label: 'Year 5', amount: Math.round(base * 2.05) },
    ];
  }
  if (chartType === 'statement_breakdown') {
    return [
      { label: 'Balance', amount: values[0] || 4500 },
      { label: 'Minimum due', amount: values[1] || 150 },
      { label: 'Interest', amount: values[2] || 82 },
      { label: 'Fees', amount: values[3] || 35 },
    ];
  }
  if (chartType === 'fee_explosion') {
    return [
      { label: 'Late fee', amount: values[0] || 35 },
      { label: 'Interest', amount: values[1] || 82 },
      { label: 'Add-ons', amount: values[2] || 120 },
      { label: 'Penalties', amount: values[3] || 45 },
    ];
  }
  if (chartType === 'before_after_cashflow') {
    return [
      { label: 'Before', amount: values[0] || 590 },
      { label: 'After', amount: values[1] || 240 },
    ];
  }
  if (/\b(car|vehicle|dealership|auto)\b/i.test(text)) {
    return [
      { label: 'Payment', amount: values[0] || 590 },
      { label: 'Insurance', amount: values[1] || 170 },
      { label: 'Gas', amount: values[2] || 220 },
      { label: 'Maintenance', amount: values[3] || 95 },
      { label: 'Fees', amount: values[4] || 60 },
    ];
  }
  return [
    { label: 'Main bill', amount: values[0] || 450 },
    { label: 'Fees', amount: values[1] || 85 },
    { label: 'Interest', amount: values[2] || 120 },
    { label: 'Buffer', amount: values[3] || 75 },
  ];
}

function shortTitle(scene: VideoPlanSceneInput, chartType: ChartType) {
  const text = safeText(scene);
  if (/\b(overdraft|declined|pending|low balance|bank app|debit)\b/i.test(text)) {
    if (chartType === 'fee_explosion') return 'When The Fee Hits';
    if (chartType === 'before_after_cashflow') return 'The Buffer That Stops The Fee';
    return 'Why The Balance Was Wrong';
  }
  if (chartType === 'interest_trap_timeline') return 'The Cost Grows Over Time';
  if (chartType === 'statement_breakdown') return 'The Statement Shows The Trap';
  if (chartType === 'fee_explosion') return 'Small Fees Become Real Money';
  if (chartType === 'before_after_cashflow') return 'Before And After The Decision';
  if (/\b(car|vehicle|dealership|auto)\b/i.test(text)) return 'The Real Cost Of The Car';
  if (/\b(rent|mortgage|housing)\b/i.test(text)) return 'The Housing Payment Stack';
  return 'The Real Monthly Cost';
}

function buildChartPayload(scene: VideoPlanSceneInput, intent: SceneIntent, chartType: ChartType): ChartPayload {
  return {
    chartType,
    title: shortTitle(scene, chartType),
    subtitle: titleCase(intent.label),
    values: chartValuesFor(scene, chartType),
    duration: Math.max(4, Math.min(7, Math.round(scene.duration || 5))),
    sceneId: scene.sceneId || `scene-${scene.sceneIndex || 0}`,
    voiceoverBeat: conciseBeat(scene),
    style: 'bills_to_wealth_hmw',
    emphasis: chartType === 'fee_explosion' ? 'Watch the fees' : 'Follow the money',
  };
}

function chooseChartSceneIndexes(scenes: VideoPlanSceneInput[], targetChartCount: number) {
  const candidates = scenes
    .map((scene, index) => {
      const text = safeText(scene);
      let score = hasNumbers(text) ? 8 : 0;
      if (/\b(apr|interest|fee|payment|monthly|balance|statement|rent|mortgage|insurance|gas|save|savings)\b/i.test(text)) score += 7;
      if (/\b(here is|watch|number|cost|trap|real|hidden)\b/i.test(text)) score += 3;
      return { scene, index, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const selected: number[] = [];
  for (const item of candidates) {
    if (selected.length >= targetChartCount) break;
    const tooClose = selected.some((index) => Math.abs(index - item.index) < 2);
    if (!tooClose) selected.push(item.index);
  }
  return new Set(selected.sort((a, b) => a - b));
}

function makeTextFallback(scene: VideoPlanSceneInput, intent: SceneIntent, usedFingerprints: Set<string>) {
  const text = safeText(scene);
  const fingerprint = `text:${scene.sceneIndex || 0}:${intent.label}:${text.slice(0, 48)}`;
  const fallbackTitle = fallbackTitleFor(scene, intent);
  usedFingerprints.add(fingerprint);
  return {
    sceneIndex: scene.sceneIndex || 0,
    sceneId: scene.sceneId || `scene-${scene.sceneIndex || 0}`,
    narration: text,
    duration: scene.duration || 4,
    visualType: 'text' as const,
    visualIntent: intent.label,
    brollQuery: intent.query,
    fallbackTitle,
    fallbackKicker: kickerFor(text),
    fallbackText: conciseBeat(scene),
    suppressCaptions: false,
    visualFingerprint: fingerprint,
    relevanceScore: 0,
    qa: {
      duplicate: false,
      reason: 'No b-roll clip reached the minimum relevance score; use editorial text/graphics fallback.',
      warnings: ['broll_not_relevant_enough'],
    },
  };
}

function kickerFor(text: string) {
  if (/\boverdraft|fee|penalty|declined\b/i.test(text)) return 'Real Cost';
  if (/\bsave|buffer|emergency\b/i.test(text)) return 'Move Two';
  if (/\bwatch|pay attention|hidden|trap\b/i.test(text)) return 'Pay Attention';
  return 'Why It Matters';
}

function fallbackTitleFor(scene: VideoPlanSceneInput, intent: SceneIntent) {
  const text = safeText(scene);
  if (/\boverdraft|declined|pending\b/i.test(text)) return 'The Fee Was Set Up Before It Hit';
  if (/\bbalance|bank app|alert\b/i.test(text)) return 'The App Is Not The Whole Story';
  if (/\bsave|buffer|emergency\b/i.test(text)) return 'Build A Buffer Before The Fee';
  if (/\bpaperwork|contract|sign\b/i.test(text)) return 'The Paperwork Hides The Real Cost';
  return titleCase(intent.label);
}

export function planVideoVisuals(
  scenes: VideoPlanSceneInput[],
  clips: BrollClip[],
  options: VideoPlanOptions = {},
) {
  const targetChartCount = Math.max(0, Math.min(12, options.targetChartCount ?? DEFAULT_TARGET_CHARTS));
  const minBrollScore = options.minBrollScore ?? MIN_BROLL_SCORE;
  const minRescueBrollScore = options.minRescueBrollScore ?? MIN_RESCUE_BROLL_SCORE;
  const chartIndexes = chooseChartSceneIndexes(scenes, targetChartCount);
  const usedFingerprints = new Set<string>();
  const planned: PlannedVisualScene[] = [];
  const sceneCandidateCount = scenes.reduce(
    (total, scene) => total + (Array.isArray(scene.candidates) ? scene.candidates.length : 0),
    0,
  );
  let previousChartType: ChartType | undefined;

  scenes.forEach((scene, index) => {
    const sceneIndex = scene.sceneIndex ?? index + 1;
    const normalizedScene = { ...scene, sceneIndex };
    const narration = safeText(normalizedScene);
    const intent = inferSceneIntent(normalizedScene);

    if (chartIndexes.has(index)) {
      const chartType = chooseChartType(normalizedScene, intent, previousChartType);
      previousChartType = chartType;
      const chartPayload = buildChartPayload(normalizedScene, intent, chartType);
      const visualFingerprint = `chart:${chartType}:${sceneIndex}:${intent.label}`;
      usedFingerprints.add(visualFingerprint);
      planned.push({
        sceneIndex,
        sceneId: normalizedScene.sceneId || `scene-${sceneIndex}`,
        narration,
        duration: normalizedScene.duration || 5,
        visualType: 'chart',
        visualIntent: intent.label,
        chartPayload,
        chartType,
        suppressCaptions: true,
        visualFingerprint,
        relevanceScore: 1,
        qa: {
          duplicate: false,
          reason: 'Selected as a Remotion chart beat because the narration contains numbers or money mechanics.',
          warnings: [],
        },
      });
      return;
    }

    previousChartType = undefined;
    const sceneClips = Array.isArray(normalizedScene.candidates) && normalizedScene.candidates.length
      ? normalizedScene.candidates
      : clips;
    const selectedClip = selectBrollClip(sceneClips, intent, usedFingerprints, minBrollScore);
    const rescueClip = selectedClip || selectBrollClip(sceneClips, intent, usedFingerprints, minRescueBrollScore);
    if (!rescueClip) {
      planned.push(makeTextFallback(normalizedScene, intent, usedFingerprints));
      return;
    }

    const visualFingerprint = rescueClip.clipId;
    usedFingerprints.add(visualFingerprint);
    planned.push({
      sceneIndex,
      sceneId: normalizedScene.sceneId || `scene-${sceneIndex}`,
      narration,
      duration: normalizedScene.duration || 4,
      visualType: 'broll',
      visualIntent: intent.label,
      brollQuery: intent.query,
      selectedClip: rescueClip,
      visualFingerprint,
      relevanceScore: Number((rescueClip.score / 50).toFixed(2)),
      qa: {
        duplicate: false,
        reason: `Matched ${rescueClip.category} using intent terms: ${intent.desiredTerms.slice(0, 5).join(', ')}.`,
        warnings: [
          ...((rescueClip as SelectedBrollClip & { warnings?: string[] }).warnings || []),
          ...(selectedClip ? [] : ['rescue_broll_used_to_avoid_placeholder_card']),
        ],
      },
    });
  });

  const qaInput: VisualPlanScene[] = planned
    .map((scene) => ({
      sceneIndex: scene.sceneIndex,
      visualType: scene.visualType,
      chartType: scene.chartType,
      assetUrl: scene.selectedClip?.url,
      providerId: scene.selectedClip?.clipId,
      query: scene.brollQuery || scene.visualIntent,
      fingerprint: scene.visualFingerprint,
      visualIntent: scene.visualIntent,
      title: scene.chartPayload?.title || scene.fallbackTitle,
      subtitle: scene.chartPayload?.subtitle || scene.fallbackKicker,
      visibleText: scene.fallbackText || scene.chartPayload?.voiceoverBeat,
    }));
  const qa = validateVisualPlan(qaInput);
  const brollCount = planned.filter((scene) => scene.visualType === 'broll').length;
  const chartCount = planned.filter((scene) => scene.visualType === 'chart').length;
  const fallbackCount = planned.filter((scene) => scene.visualType === 'text').length;

  return {
    ok: qa.ok,
    version: 'v62_priority_upgrade_guardrails',
    summary: {
      scenes: planned.length,
      brollCount,
      chartCount,
      fallbackCount,
      targetChartCount,
      clipsAvailable: clips.length || sceneCandidateCount,
      qaScore: qa.score,
    },
    scenes: planned,
    qaReport: qa,
  };
}
