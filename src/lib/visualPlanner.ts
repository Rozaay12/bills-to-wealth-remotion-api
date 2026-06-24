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
const ABSOLUTE_MAX_AUTOMATED_CHARTS = 8;
const DEFAULT_INTENT_PROFILE_INDEX = 4; // budgeting/monthly bills is safer than car/dealership for unknown beats.
const KNOWN_LIBRARY_CATEGORY = /^\d{2}_[a-z0-9_]+$/;

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
    categories: ['02_savings_banking', '18_budgeting_bank_app', '01_debt_credit_cards', '04_budgeting'],
    keywords: ['overdraft', 'fee', 'debit', 'declined', 'pending', 'gas', 'pump', 'checkout', 'balance', 'alert', 'banking'],
    desiredTerms: ['debit card', 'bank app', 'balance', 'overdraft fee', 'pending charge', 'checkout', 'receipt', 'low balance alert'],
    forbiddenTerms: ['repair', 'mechanic', 'tire', 'wheel', 'hood', 'jack', 'oil', 'garage', 'tools'],
    chartTypes: ['fee_explosion', 'statement_breakdown', 'before_after_cashflow'],
  },
  {
    label: 'payday wallet and cash buffer',
    categories: ['07_income_paycheck', '18_budgeting_bank_app', '04_budgeting', '02_savings_banking', '05_stress_worry'],
    keywords: ['payday', 'wallet', 'cash', 'buffer', 'careful', 'thursday', 'short', 'gap', 'calendar', 'envelope'],
    desiredTerms: ['paycheck', 'wallet', 'cash', 'calendar', 'envelope', 'bank app', 'budget', 'bill due date'],
    chartTypes: ['before_after_cashflow', 'payment_stack', 'statement_breakdown'],
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
    keywords: ['grocery', 'groceries', 'food', 'supermarket', 'prices', 'inflation', 'receipt', 'cereal', 'bakery', 'shelf', 'unit price', 'ounce', 'ounces', 'shrinkflation', 'store brand', 'cart'],
    desiredTerms: ['grocery', 'supermarket', 'receipt', 'price tag', 'unit price', 'shelf tag', 'shopping cart', 'produce', 'cereal', 'bakery'],
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
    keywords: ['medical', 'doctor', 'hospital', 'copay', 'healthcare', 'insurance', 'pharmacy', 'er', 'emergency', 'chargemaster', 'itemized', 'trauma activation', 'eob', 'uninsured', 'underinsured'],
    desiredTerms: ['medical bill', 'hospital bill', 'doctor', 'pharmacy', 'hospital', 'insurance', 'copay', 'EOB', 'itemized bill', 'paperwork', 'documents', 'phone call', 'kitchen table'],
    forbiddenTerms: ['repair', 'mechanic', 'tire', 'wheel', 'hood', 'jack', 'oil', 'garage', 'tools', 'grocery', 'supermarket', 'cereal', 'cart'],
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
    keywords: ['car', 'vehicle', 'auto', 'mechanic', 'repair', 'maintenance', 'gas', 'dealership', 'dealer', 'auto loan'],
    desiredTerms: ['car', 'vehicle', 'mechanic', 'repair', 'gas pump', 'maintenance', 'dealership', 'auto loan'],
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

function stripWorkflowAnnotations(value = '') {
  return value
    .replace(/\|\s*v\d+_[a-z0-9_ -]+=[^|]+/gi, ' ')
    .replace(/\b(?:bill zoom[- ]?in|free money tool|source card|visual intent|b-roll query|chart payload|lower third|cta):\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collapseRepeatedSentences(value = '') {
  const stripped = stripWorkflowAnnotations(value);
  const sentences = stripped.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [stripped];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const sentence of sentences) {
    const cleaned = cleanVisibleText(sentence).trim();
    const key = normalizeText(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(cleaned);
  }
  return deduped.join(' ').replace(/\s+/g, ' ').trim();
}

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
  const seenValues = new Set<string>();
  const visible = [
    scene.narration,
    scene.voiceoverBeat,
    scene.voiceoverText,
    scene.text,
    isOnlyBackendHint(scene.visualIntent || '') ? '' : scene.visualIntent,
  ]
    .filter(Boolean)
    .map((value) => collapseRepeatedSentences(String(value)))
    .filter((value) => {
      const key = normalizeText(value);
      if (!key || seenValues.has(key)) return false;
      seenValues.add(key);
      return true;
    })
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

function matchAny(text: string, terms: string[]) {
  return countMatches(text, terms) > 0;
}

type VisualRequirementGroups = {
  action: string[];
  object: string[];
  location: string[];
  strict: boolean;
  reason: string;
};

function visualRequirementGroups(sceneText: string, intent: SceneIntent): VisualRequirementGroups {
  const text = normalizeText(sceneText);
  const base: VisualRequirementGroups = {
    action: [],
    object: [],
    location: [],
    strict: true,
    reason: intent.label,
  };

  if (/\b(sign|signed|signing|paperwork|contract|documents?|loan officer|finance manager|dealership)\b/i.test(sceneText)) {
    return {
      action: ['sign', 'signing', 'write', 'review', 'hand', 'slide', 'fill out'],
      object: ['paperwork', 'contract', 'document', 'documents', 'forms', 'signature', 'pen', 'loan', 'financing'],
      location: ['desk', 'office', 'dealership', 'table'],
      strict: true,
      reason: 'paperwork/signing beat requires paperwork visuals',
    };
  }

  if (isCarBeat(sceneText)) {
    return {
      action: ['drive', 'repair', 'pay', 'sign', 'review'],
      object: ['car', 'vehicle', 'loan', 'payment', 'insurance', 'gas', 'mechanic'],
      location: ['dealership', 'garage', 'repair shop', 'gas station', 'desk'],
      strict: /\b(sign|signed|signing|paperwork|contract|loan|dealership)\b/i.test(sceneText),
      reason: 'car beat requires car/dealership/payment visuals',
    };
  }

  if (isMedicalBeat(sceneText)) {
    return {
      action: ['open', 'read', 'review', 'compare', 'call', 'negotiate', 'pay'],
      object: ['medical bill', 'hospital bill', 'invoice', 'statement', 'insurance', 'eob', 'documents', 'paperwork', 'phone'],
      location: ['hospital', 'doctor', 'clinic', 'pharmacy', 'desk', 'kitchen table', 'home'],
      strict: true,
      reason: 'medical billing beat requires medical/document visuals',
    };
  }

  if (isGroceryBeat(sceneText)) {
    return {
      action: ['shop', 'checkout', 'scan', 'compare', 'pay', 'read'],
      object: ['receipt', 'cart', 'price tag', 'shelf tag', 'unit price', 'groceries', 'food', 'cereal', 'package'],
      location: ['grocery', 'supermarket', 'store', 'checkout', 'aisle', 'shelf'],
      strict: true,
      reason: 'grocery beat requires store/receipt/price visuals',
    };
  }

  if (/\b(overdraft|debit|declined|pending|bank app|balance|checking|savings|deposit)\b/i.test(sceneText)) {
    return {
      action: ['check', 'tap', 'decline', 'pay', 'transfer', 'deposit'],
      object: ['debit card', 'bank app', 'phone', 'balance', 'statement', 'alert', 'card'],
      location: ['checkout', 'store', 'gas pump', 'desk', 'home'],
      strict: true,
      reason: 'banking beat requires card/app/balance visuals',
    };
  }

  return {
    ...base,
    action: intent.highSignalTokens.slice(0, 3),
    object: intent.desiredTerms.slice(0, 5),
    location: intent.categories.map((category) => category.replace(/^\d+_/, '').replace(/_/g, ' ')),
    strict: false,
  };
}

function matchedRequirementGroupCount(clipTextValue: string, groups: VisualRequirementGroups) {
  const normalized = normalizeText(clipTextValue);
  return [
    matchAny(normalized, groups.action),
    matchAny(normalized, groups.object),
    matchAny(normalized, groups.location),
  ].filter(Boolean).length;
}

function forbiddenCategoryPenalty(category: string, intent: SceneIntent) {
  if (!KNOWN_LIBRARY_CATEGORY.test(category)) return 0;
  return intent.categories.includes(category) ? 0 : 24;
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

  const winner = scored[0]?.score > 0 ? scored[0].profile : intentProfiles[DEFAULT_INTENT_PROFILE_INDEX];
  const isPaperwork =
    /\b(sign|signed|signing|paperwork|contract|documents?|loan officer|finance manager|dealership)\b/i.test(text) &&
    /\b(car|auto|vehicle|dealership|loan|keys)\b/i.test(text);

  const medicalProfile = intentProfiles.find((profile) => profile.label === 'healthcare and medical bills') || winner;
  const profile = isPaperwork ? intentProfiles[2] : (isMedicalBeat(text) ? medicalProfile : winner);
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

function scoreClip(clip: BrollClip, intent: SceneIntent, usedFingerprints: Set<string>, sceneText = '') {
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
  const requirementGroups = visualRequirementGroups(sceneText, intent);
  const matchedGroups = matchedRequirementGroupCount(text, requirementGroups);
  const categoryPenalty = forbiddenCategoryPenalty(category, intent);

  score += quality;

  if (intent.categories.includes(String(category))) score += 12;
  if (categoryPenalty) {
    score -= categoryPenalty;
    warnings.push('wrong_story_category');
  }
  score += countMatches(normalized, intent.desiredTerms) * 4;
  score += countMatches(normalized, intent.highSignalTokens) * 2;
  score += matchedGroups * 7;

  if (requirementGroups.strict && matchedGroups < 2) {
    score -= 28;
    warnings.push(`failed_action_object_location_gate:${requirementGroups.reason}`);
  } else if (!requirementGroups.strict && matchedGroups === 0) {
    score -= 10;
    warnings.push('weak_editorial_match');
  }

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
  if (!isCarBeat(sceneText) && /\b(er|hospital|medical|chargemaster|itemized|insurance|eob)\b/i.test(sceneText) && /\b(grocery|supermarket|checkout|cart|cereal|produce|mechanic|repair|tire|wheel|garage)\b/i.test(text)) {
    score -= 24;
    warnings.push('medical_scene_rejects_unrelated_visual');
  }

  return { score, warnings };
}

function selectBrollClip(
  clips: BrollClip[],
  intent: SceneIntent,
  usedFingerprints: Set<string>,
  minScore: number,
  sceneText = '',
) {
  const ranked = clips
    .map((clip) => {
      const result = scoreClip(clip, intent, usedFingerprints, sceneText);
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

function humanVisualIntent(scene: VideoPlanSceneInput, intent: SceneIntent) {
  const text = safeText(scene);
  if (/\b(sign|signed|signing|paperwork|contract|documents?)\b/i.test(text)) return 'Show the paperwork, signature, and decision point.';
  if (isMedicalBeat(text)) return 'Show the medical bill, paperwork, clinic, or billing call.';
  if (isGroceryBeat(text)) return 'Show the receipt, price tag, or grocery checkout detail.';
  if (/\boverdraft|declined|pending|low balance|bank app\b/i.test(text)) return 'Show the card, bank app, balance, or declined payment moment.';
  if (isCarBeat(text)) return 'Show the car payment, dealership paperwork, or transportation cost.';
  if (/\bsave|buffer|emergency\b/i.test(text)) return 'Show the savings buffer or relief moment.';
  return `Show the specific money decision: ${intent.query}`.slice(0, 120);
}

function hasNumbers(text: string) {
  return /(\$|\b\d+%|\bapr\b|\binterest\b|\bfee\b|\bpayment\b|\bmonthly\b|\bbalance\b)/i.test(text);
}

function isGroceryBeat(text: string) {
  return /\b(grocery|groceries|supermarket|checkout|receipt|shelf|unit price|per ounce|ounces?|package|shrinkflation|store brand|food price|cart|cereal|bakery|produce|store aisle)\b/i.test(text);
}

function isMedicalBeat(text: string) {
  return /\b(er|emergency room|hospital|medical|doctor|copay|healthcare|pharmacy|chargemaster|itemized|trauma activation|eob|patient|clinic)\b/i.test(text) ||
    (/\binsurance\b/i.test(text) && /\b(card|copay|bill|invoice|doctor|hospital|medical|healthcare|eob|patient|clinic)\b/i.test(text));
}

function isCarBeat(text: string) {
  if (isMedicalBeat(text)) return false;
  return /\b(car|vehicle|dealership|dealer|auto loan|mechanic|repair|gas pump|gas station|maintenance)\b/i.test(text) ||
    (/\binsurance\b/i.test(text) && /\b(car|vehicle|auto|driver|dealer|dealership|gas|maintenance|repair)\b/i.test(text));
}

function isChartWorthyText(text: string) {
  const numberWord = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)';
  const hasExplicitMetric =
    /(\$|\b\d+(?:\.\d+)?\s?%|\b\d+\s?(?:dollars?|bucks?|months?|years?|weeks?|ounces?|oz|per|lower|higher|less|more)\b)/i.test(text) ||
    new RegExp(`\\b${numberWord}\\s+(?:dollars?|bucks?|percent|months?|years?|weeks?|ounces?|items?|products?)\\b`, 'i').test(text);
  const hasFinanceMechanic = /\b(apr|interest|fee|payment|monthly|balance|statement|rent|mortgage|insurance|save|savings|refund|cost|price|unit price|per ounce|shrinkflation|inflation|budget|debt|cashflow|buffer)\b/i.test(text);
  return hasExplicitMetric && hasFinanceMechanic;
}

function chooseChartType(scene: VideoPlanSceneInput, intent: SceneIntent, previousChartType?: ChartType): ChartType {
  const text = safeText(scene);
  const preferred = [...intent.chartTypes];
  if (isMedicalBeat(text)) preferred.unshift('statement_breakdown', 'fee_explosion');
  if (/\b(apr|interest|compound|years?|months?)\b/i.test(text)) preferred.unshift('interest_trap_timeline');
  if (/\b(statement|minimum|due date|balance)\b/i.test(text)) preferred.unshift('statement_breakdown');
  if (/\b(fee|late|overdraft|penalty|add on|addon)\b/i.test(text)) preferred.unshift('fee_explosion');
  if (/\b(before|after|instead|switch|save|savings)\b/i.test(text)) preferred.unshift('before_after_cashflow');
  if (!isMedicalBeat(text) && /\b(monthly|payment|insurance|gas|rent|budget)\b/i.test(text)) preferred.unshift('payment_stack');

  const uniquePreferred = unique(preferred.filter((type) => chartTypes.includes(type)));
  return uniquePreferred.find((type) => type !== previousChartType) || uniquePreferred[0] || 'payment_stack';
}

function extractMoneyValues(text: string) {
  const matches = Array.from(text.matchAll(/\$?\b(\d{1,3}(?:,\d{3})+|\d{2,6})\b/g))
    .map((match) => Number(match[1].replace(/,/g, '')))
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, 5);
  return matches.length ? matches : [];
}

function extractDollarValues(text: string) {
  return Array.from(text.matchAll(/\$\s*(\d{1,3}(?:,\d{3})+|\d{1,6})\b/g))
    .map((match) => Number(match[1].replace(/,/g, '')))
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, 5);
}

function chartValuesFor(scene: VideoPlanSceneInput, chartType: ChartType) {
  const text = safeText(scene);
  const values = extractMoneyValues(text);
  if (isMedicalBeat(text)) {
    const dollarValues = extractDollarValues(text);
    const percent = Number((text.match(/\b(\d+(?:\.\d+)?)\s?%/) || [])[1]);
    const copay = dollarValues.find((value) => value <= 150) || 20;
    const surpriseBill = dollarValues.find((value) => value >= 200) || values.find((value) => value >= 200) || 1200;
    if (/\b(chargemaster|uninsured|underinsured|facility fee|trauma activation)\b/i.test(text) || chartType === 'fee_explosion') {
      return [
        { label: 'Copay', amount: copay },
        { label: 'Facility fee', amount: Math.max(300, Math.round(surpriseBill * 0.55)) },
        { label: 'Extra charges', amount: Math.max(150, Math.round(surpriseBill * 0.3)) },
        { label: 'Total surprise', amount: surpriseBill },
      ];
    }
    return [
      { label: 'Copay', amount: copay },
      { label: 'Surprise invoice', amount: surpriseBill },
      { label: 'Skipped care', amount: Number.isFinite(percent) ? percent : 26 },
    ];
  }
  if (isGroceryBeat(text)) {
    if (/\b(unit price|per ounce|ounces?|oz)\b/i.test(text)) {
      return [
        { label: 'Shelf price', amount: values[0] || 6 },
        { label: 'Ounces', amount: values[1] || 12 },
        { label: 'Cost per ounce', amount: values[2] || 50 },
      ];
    }
    if (/\b(shrinkflation|package|smaller|less)\b/i.test(text)) {
      return [
        { label: 'Old package', amount: values[0] || 16 },
        { label: 'New package', amount: values[1] || 14 },
        { label: 'Real increase', amount: values[2] || 12 },
      ];
    }
    return [
      { label: 'Shelf price', amount: values[0] || 6 },
      { label: 'Unit price', amount: values[1] || 50 },
      { label: 'Weekly cart', amount: values[2] || 140 },
      { label: 'Possible savings', amount: values[3] || 40 },
    ];
  }
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
  if (isCarBeat(text)) {
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
  if (isMedicalBeat(text)) {
    if (/\b(chargemaster|uninsured|underinsured)\b/i.test(text)) return 'The Hospital Sticker Price Trap';
    if (/\b(facility fee|trauma activation|extra charges)\b/i.test(text)) return 'The Hidden Facility Fee';
    if (/\b(eob|insurance)\b/i.test(text)) return 'What Insurance Says Vs What They Billed';
    return 'The Medical Bill Breakdown';
  }
  if (isGroceryBeat(text)) {
    if (/\b(unit price|per ounce|ounces?|oz)\b/i.test(text)) return 'The Unit Price Trap';
    if (/\b(shrinkflation|package|smaller|less)\b/i.test(text)) return 'Shrinkflation Hides Here';
    return 'The Grocery Price Trap';
  }
  if (/\b(overdraft|declined|pending|low balance|bank app|debit)\b/i.test(text)) {
    if (chartType === 'fee_explosion') return 'When The Fee Hits';
    if (chartType === 'before_after_cashflow') return 'The Buffer That Stops The Fee';
    return 'Why The Balance Was Wrong';
  }
  if (chartType === 'interest_trap_timeline') return 'The Cost Grows Over Time';
  if (chartType === 'statement_breakdown') return 'The Statement Shows The Trap';
  if (chartType === 'fee_explosion') return 'Small Fees Become Real Money';
  if (chartType === 'before_after_cashflow') return 'Before And After The Decision';
  if (isCarBeat(text)) return 'The Real Cost Of The Car';
  if (/\b(rent|mortgage|housing)\b/i.test(text)) return 'The Housing Payment Stack';
  return 'The Real Monthly Cost';
}

function buildChartPayload(scene: VideoPlanSceneInput, intent: SceneIntent, chartType: ChartType): ChartPayload {
  return {
    chartType,
    title: shortTitle(scene, chartType),
    subtitle: subtitleForScene(scene, intent),
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
      if (!isChartWorthyText(text)) return { scene, index, score: 0 };
      let score = hasNumbers(text) ? 8 : 4;
      if (/\b(apr|interest|fee|payment|monthly|balance|statement|rent|mortgage|insurance|gas|save|savings|unit price|per ounce|shrinkflation|inflation|checkout|receipt)\b/i.test(text)) score += 7;
      if (/\b(here is|watch|number|cost|trap|real|hidden|compare|lower|higher|less|more)\b/i.test(text)) score += 3;
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

function recommendedChartCountFor(scenes: VideoPlanSceneInput[]) {
  if (scenes.length >= 32) return DEFAULT_TARGET_CHARTS;
  if (scenes.length >= 20) return 4;
  if (scenes.length >= 10) return 3;
  return Math.min(2, scenes.length);
}

function makeTextFallback(scene: VideoPlanSceneInput, intent: SceneIntent, usedFingerprints: Set<string>) {
  const text = safeText(scene);
  const fingerprint = `text:idx${scene.sceneIndex || 0}:${intent.label}:${text.slice(0, 48)}`;
  const fallbackTitle = fallbackTitleFor(scene, intent);
  usedFingerprints.add(fingerprint);
  return {
    sceneIndex: scene.sceneIndex || 0,
    sceneId: scene.sceneId || `scene-${scene.sceneIndex || 0}`,
    narration: text,
    duration: scene.duration || 4,
    visualType: 'text' as const,
    visualIntent: humanVisualIntent(scene, intent),
    brollQuery: intent.query,
    fallbackTitle,
    fallbackKicker: kickerFor(text),
    fallbackText: conciseBeat(scene),
    suppressCaptions: true,
    visualFingerprint: fingerprint,
    relevanceScore: 0,
    qa: {
      duplicate: false,
      reason: 'No b-roll clip reached the minimum relevance score; use editorial text/graphics fallback.',
      warnings: ['broll_not_relevant_enough'],
    },
  };
}

function chartFromTextFallback(
  plannedScene: PlannedVisualScene,
  originalScene: VideoPlanSceneInput,
  previousChartType?: ChartType,
) {
  const normalizedScene = {
    ...originalScene,
    sceneIndex: plannedScene.sceneIndex,
    sceneId: plannedScene.sceneId,
    duration: plannedScene.duration,
  };
  const intent = inferSceneIntent(normalizedScene);
  const chartType = chooseChartType(normalizedScene, intent, previousChartType);
  const chartPayload = buildChartPayload(normalizedScene, intent, chartType);
  return {
    ...plannedScene,
    visualType: 'chart' as const,
    chartType,
    chartPayload,
    suppressCaptions: true,
    visualFingerprint: `chart:${chartType}:idx${plannedScene.sceneIndex}:${intent.label}`,
    relevanceScore: 1,
    qa: {
      duplicate: false,
      reason: 'Promoted fallback text into a Remotion chart to prevent long static text-card streaks.',
      warnings: [],
    },
  };
}

function rebalanceFallbacksWithCharts(planned: PlannedVisualScene[], scenes: VideoPlanSceneInput[], chartBudget: number) {
  let chartCount = planned.filter((scene) => scene.visualType === 'chart').length;
  if (chartCount >= chartBudget) return planned;

  const next = [...planned];
  let textStreak = 0;
  let previousChartType: ChartType | undefined;

  for (let i = 0; i < next.length; i += 1) {
    const scene = next[i];
    if (scene.visualType === 'chart') {
      textStreak = 0;
      previousChartType = scene.chartType;
      continue;
    }
    if (scene.visualType !== 'text') {
      textStreak = 0;
      previousChartType = undefined;
      continue;
    }

    textStreak += 1;
    const narration = scene.narration || '';
    const shouldPromote = isChartWorthyText(narration);
    if (shouldPromote && chartCount < chartBudget) {
      next[i] = chartFromTextFallback(scene, scenes[i] || scene, previousChartType);
      chartCount += 1;
      textStreak = 0;
      previousChartType = next[i].chartType;
    }
  }

  return next;
}

function kickerFor(text: string) {
  if (/\b(er|hospital|medical|chargemaster|itemized|insurance|eob|copay|doctor|pharmacy)\b/i.test(text)) return 'Hospital Bill';
  if (/\b(sign|signed|signing|paperwork|contract|documents?|loan officer|finance manager)\b/i.test(text)) return 'Paperwork';
  if (isGroceryBeat(text)) return 'Receipt Check';
  if (/\boverdraft|fee|penalty|declined\b/i.test(text)) return 'Real Cost';
  if (/\bsave|buffer|emergency\b/i.test(text)) return 'Move Two';
  if (/\bwatch|pay attention|hidden|trap\b/i.test(text)) return 'Pay Attention';
  return 'Why It Matters';
}

function subtitleForScene(scene: VideoPlanSceneInput, intent: SceneIntent) {
  const text = safeText(scene);
  if (isMedicalBeat(text)) {
    if (/\b(chargemaster|uninsured|underinsured)\b/i.test(text)) return 'The sticker price is not the final price.';
    if (/\b(itemized|billing department|call|phone)\b/i.test(text)) return 'Use the bill against itself.';
    if (/\b(eob|insurance|insurer)\b/i.test(text)) return 'Compare what they billed to what insurance says.';
    return 'The copay is not the whole bill.';
  }
  if (isCarBeat(text) && /\b(insurance|gas|maintenance|payment|fees|monthly)\b/i.test(text)) return 'The payment is only one piece.';
  if (/\b(chargemaster|uninsured|underinsured)\b/i.test(text)) return 'The sticker price is not the final price.';
  if (/\b(itemized|billing department|call|phone)\b/i.test(text)) return 'Use the bill against itself.';
  if (/\b(eob|insurer)\b/i.test(text) || (/\binsurance\b/i.test(text) && /\b(hospital|medical|doctor|copay|healthcare|bill)\b/i.test(text))) return 'Compare what they billed to what insurance says.';
  if (/\b(sign|signed|signing|paperwork|contract)\b/i.test(text)) return 'The details are in the document.';
  if (isGroceryBeat(text)) return 'The receipt tells the truth.';
  if (/\boverdraft|declined|pending|low balance\b/i.test(text)) return 'The fee starts before it posts.';
  if (/\bsave|buffer|emergency\b/i.test(text)) return 'The buffer changes the outcome.';
  if (intent.label.includes('budget')) return 'The monthly number is only the beginning.';
  return 'Follow the money in this moment.';
}

function fallbackTitleFor(scene: VideoPlanSceneInput, intent: SceneIntent) {
  const text = safeText(scene);
  if (isMedicalBeat(text)) {
    if (/\b(chargemaster|uninsured|underinsured)\b/i.test(text)) return 'The Hospital Price Is Not The Final Price';
    if (/\b(itemized|billing department|call|phone)\b/i.test(text)) return 'Call Billing Before You Pay';
    if (/\b(eob|insurance|insurer)\b/i.test(text)) return 'Compare The Bill To The EOB';
    return 'The Bill Is An Opening Offer';
  }
  if (isCarBeat(text) && /\b(insurance|gas|maintenance|fees|real cost|payment)\b/i.test(text)) return 'The Payment Is Not The Price';
  if (/\b(chargemaster|uninsured|underinsured)\b/i.test(text)) return 'The Hospital Price Is Not The Final Price';
  if (/\b(itemized|billing department|call|phone)\b/i.test(text)) return 'Call Billing Before You Pay';
  if (/\b(eob|insurer)\b/i.test(text) || (/\binsurance\b/i.test(text) && /\b(hospital|medical|doctor|copay|healthcare|bill)\b/i.test(text))) return 'Compare The Bill To The EOB';
  if (/\b(er|emergency room|medical bill|hospital bill|trauma activation)\b/i.test(text)) return 'The Bill Is An Opening Offer';
  if (isGroceryBeat(text) && /\b(unit price|per ounce|ounces?|oz)\b/i.test(text)) return 'Check The Unit Price';
  if (isGroceryBeat(text) && /\b(shrinkflation|package|smaller|less)\b/i.test(text)) return 'Shrinkflation Hides In The Package';
  if (isGroceryBeat(text)) return 'The Receipt Shows The Real Price';
  if (/\boverdraft|declined|pending\b/i.test(text)) return 'The Fee Was Set Up Before It Hit';
  if (/\bbalance|bank app|alert\b/i.test(text)) return 'The App Is Not The Whole Story';
  if (/\bsave|buffer|emergency\b/i.test(text)) return 'Build A Buffer Before The Fee';
  if (/\bpaperwork|contract|sign\b/i.test(text)) return 'The Paperwork Hides The Real Cost';
  const beat = conciseBeat(scene).replace(/[.!?]+$/, '');
  if (beat.length >= 18 && beat.length <= 70) return beat;
  return subtitleForScene(scene, intent).replace(/[.!?]+$/, '');
}

export function planVideoVisuals(
  scenes: VideoPlanSceneInput[],
  clips: BrollClip[],
  options: VideoPlanOptions = {},
) {
  const recommendedTargetCharts = recommendedChartCountFor(scenes);
  const requestedChartCount = Number.isFinite(options.targetChartCount)
    ? Number(options.targetChartCount)
    : undefined;
  const targetChartCount = Math.max(
    recommendedTargetCharts,
    Math.min(12, requestedChartCount ?? DEFAULT_TARGET_CHARTS),
  );
  const chartBudget = Math.min(
    ABSOLUTE_MAX_AUTOMATED_CHARTS,
    Math.max(targetChartCount, Math.ceil(scenes.length * 0.18)),
  );
  const minBrollScore = options.minBrollScore ?? MIN_BROLL_SCORE;
  const minRescueBrollScore = options.minRescueBrollScore ?? MIN_RESCUE_BROLL_SCORE;
  const chartIndexes = chooseChartSceneIndexes(scenes, targetChartCount);
  const usedFingerprints = new Set<string>();
  let planned: PlannedVisualScene[] = [];
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
      const visualFingerprint = `chart:${chartType}:idx${sceneIndex}:${intent.label}`;
      usedFingerprints.add(visualFingerprint);
      planned.push({
        sceneIndex,
        sceneId: normalizedScene.sceneId || `scene-${sceneIndex}`,
        narration,
        duration: normalizedScene.duration || 5,
        visualType: 'chart',
        visualIntent: humanVisualIntent(normalizedScene, intent),
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
    const selectedClip = selectBrollClip(sceneClips, intent, usedFingerprints, minBrollScore, narration);
    const rescueClip = selectedClip || selectBrollClip(sceneClips, intent, usedFingerprints, minRescueBrollScore, narration);
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
      visualIntent: humanVisualIntent(normalizedScene, intent),
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

  planned = rebalanceFallbacksWithCharts(planned, scenes, chartBudget);

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
    version: 'v65_strict_visual_director_category_gate',
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
    issues: qa.violations,
  };
}
