import { chartTypes, type ChartType } from './chartTypes.js';

export type VisualPlanScene = {
  sceneId?: string;
  sceneIndex?: number;
  visualType?: 'chart' | 'broll' | 'image' | 'text';
  chartType?: ChartType | string;
  fallbackStyle?: string;
  assetUrl?: string;
  providerId?: string;
  query?: string;
  fingerprint?: string;
  visualIntent?: string;
  title?: string;
  subtitle?: string;
  visibleText?: string;
};

export type PlanViolation = {
  level: 'error' | 'warning';
  code: string;
  sceneIndex?: number;
  message: string;
};

const normalize = (value = '') =>
  value
    .toLowerCase()
    .replace(/https?:\/\/[^/]+/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 2)
    .slice(0, 8)
    .join(' ');

const hasInternalVisibleLabel = (value = '') => {
  const normalized = value.toLowerCase();
  if (/\b(?:budget_pressure|generic_debt|generic_savings|generic_credit|generic_budget|visual_intent|broll_query|chart_payload)\b/.test(normalized)) {
    return true;
  }
  if (/\b(?:budgeting and monthly bills|car repair and transportation costs|healthcare and medical bills|stress and financial worry|banking and savings|income and paycheck|grocery inflation)\b/.test(normalized)) {
    return true;
  }
  if (/\b[a-z]+_[a-z0-9_]+\b/.test(value)) return true;
  if (/\s+#\d+\b/.test(value)) return true;
  return false;
};

export function fingerprintScene(scene: VisualPlanScene): string {
  if (scene.fingerprint) return normalize(scene.fingerprint);
  if (scene.providerId) return normalize(`${scene.visualType || ''}:${scene.providerId}`);
  if (scene.assetUrl) return normalize(scene.assetUrl);
  if (scene.chartType) return normalize(`chart:${scene.chartType}:${scene.query || ''}`);
  return normalize(`${scene.visualType || 'visual'}:${scene.query || scene.sceneId || ''}`);
}

export function validateVisualPlan(scenes: VisualPlanScene[]) {
  const violations: PlanViolation[] = [];
  const fingerprints = new Map<string, number[]>();
  const chartCounts = new Map<string, number>();
  const queryCounts = new Map<string, number>();
  const visibleTextCounts = new Map<string, number[]>();
  let previousChartType = '';
  let chartTotal = 0;
  let plainTextFallbackTotal = 0;
  let structuredTextFallbackTotal = 0;
  let plainTextFallbackStreak = 0;
  let previousFallbackStyle = '';

  scenes.forEach((scene, index) => {
    const sceneIndex = scene.sceneIndex ?? index + 1;
    const fingerprint = fingerprintScene(scene);
    if (fingerprint) {
      const list = fingerprints.get(fingerprint) || [];
      list.push(sceneIndex);
      fingerprints.set(fingerprint, list);
    }

    const query = normalize(scene.query || '');
    if (query) queryCounts.set(query, (queryCounts.get(query) || 0) + 1);

    const visibleFields = [scene.visualIntent, scene.title, scene.subtitle, scene.visibleText].filter(Boolean).join(' ');
    if (hasInternalVisibleLabel(visibleFields)) {
      violations.push({
        level: 'error',
        code: 'INTERNAL_VISIBLE_TEXT',
        sceneIndex,
        message: `Scene contains backend/internal visible text: "${visibleFields.slice(0, 120)}".`,
      });
    }
    const visibleCardText = scene.visualType === 'text'
      ? [scene.title, scene.visualIntent, scene.visibleText].filter(Boolean).join(' ')
      : [scene.title, scene.visibleText].filter(Boolean).join(' ');
    const visibleTextKey = normalize(visibleCardText);
    if (visibleTextKey && !/\b(?:subscribe|comment tracker|worksheet|download)\b/i.test(visibleFields)) {
      const list = visibleTextCounts.get(visibleTextKey) || [];
      list.push(sceneIndex);
      visibleTextCounts.set(visibleTextKey, list);
    }

    if (scene.visualType === 'text') {
      const fallbackStyle = String(scene.fallbackStyle || 'plain_text').trim();
      const isStructuredFallback = !['plain_text', 'text', 'text_interrupt'].includes(fallbackStyle);
      if (isStructuredFallback) {
        structuredTextFallbackTotal += 1;
        plainTextFallbackStreak = 0;
      } else {
        plainTextFallbackTotal += 1;
        plainTextFallbackStreak += 1;
      }
      if (!isStructuredFallback && plainTextFallbackStreak > 2) {
        violations.push({
          level: 'error',
          code: 'TEXT_FALLBACK_STREAK',
          sceneIndex,
          message: 'More than two fallback text cards appear back-to-back. Use b-roll or a finance graphic.',
        });
      }
      if (isStructuredFallback && previousFallbackStyle === fallbackStyle) {
        violations.push({
          level: 'warning',
          code: 'STRUCTURED_FALLBACK_REPEAT',
          sceneIndex,
          message: `Structured fallback style "${fallbackStyle}" repeats back-to-back.`,
        });
      }
      previousFallbackStyle = fallbackStyle;
    } else {
      plainTextFallbackStreak = 0;
      previousFallbackStyle = '';
    }

    if (scene.visualType === 'chart' || scene.chartType) {
      const chartType = String(scene.chartType || '').trim();
      chartTotal += 1;
      if (!chartTypes.includes(chartType as ChartType)) {
        violations.push({
          level: 'error',
          code: 'UNKNOWN_CHART_TYPE',
          sceneIndex,
          message: `Unknown chart type "${chartType}".`,
        });
      }
      chartCounts.set(chartType, (chartCounts.get(chartType) || 0) + 1);
      if (previousChartType && previousChartType === chartType) {
        violations.push({
          level: 'error',
          code: 'BACK_TO_BACK_CHART_TYPE',
          sceneIndex,
          message: `Chart type "${chartType}" repeats back-to-back.`,
        });
      }
      previousChartType = chartType;
    } else {
      previousChartType = '';
    }
  });

  for (const [fingerprint, sceneIndexes] of fingerprints.entries()) {
    if (sceneIndexes.length > 1) {
      violations.push({
        level: 'error',
        code: 'DUPLICATE_VISUAL_FINGERPRINT',
        sceneIndex: sceneIndexes[1],
        message: `Visual fingerprint "${fingerprint}" repeats in scenes ${sceneIndexes.join(', ')}.`,
      });
    }
  }

  const maxChartRepeats = Math.max(2, Math.ceil(chartTotal * 0.3));
  for (const [chartType, count] of chartCounts.entries()) {
    if (chartTotal >= 5 && count > maxChartRepeats) {
      violations.push({
        level: 'warning',
        code: 'CHART_TYPE_OVERUSED',
        message: `Chart type "${chartType}" appears ${count} times; limit is ${maxChartRepeats}.`,
      });
    }
  }

  const maxTextFallbacks = Math.max(2, Math.ceil(scenes.length * 0.25));
  const hardMaxTextFallbacks = Math.max(maxTextFallbacks + 2, Math.ceil(scenes.length * 0.4));
  if (plainTextFallbackTotal > hardMaxTextFallbacks) {
    violations.push({
      level: 'error',
      code: 'TEXT_FALLBACK_OVERUSED',
      message: `Plain text fallback cards appear ${plainTextFallbackTotal} times; hard limit is ${hardMaxTextFallbacks}. Use matched b-roll or Remotion graphics.`,
    });
  } else if (plainTextFallbackTotal > maxTextFallbacks) {
    violations.push({
      level: 'warning',
      code: 'TEXT_FALLBACK_HEAVY',
      message: `Plain text fallback cards appear ${plainTextFallbackTotal} times; target is ${maxTextFallbacks}. Render can continue, but add more matched B-roll or structured graphics.`,
    });
  }

  if (structuredTextFallbackTotal > Math.ceil(scenes.length * 0.6)) {
    violations.push({
      level: 'warning',
      code: 'STRUCTURED_FALLBACK_HEAVY',
      message: `Structured finance fallbacks appear ${structuredTextFallbackTotal} times. This can render, but add more B-roll candidates for a more premium edit.`,
    });
  }

  for (const [query, count] of queryCounts.entries()) {
    if (count > 2) {
      violations.push({
        level: 'warning',
        code: 'QUERY_OVERUSED',
        message: `Visual query "${query}" appears ${count} times. Use more specific scene queries.`,
      });
    }
  }

  for (const [visibleText, sceneIndexes] of visibleTextCounts.entries()) {
    if (sceneIndexes.length > 2) {
      violations.push({
        level: 'error',
        code: 'REPEATED_VISIBLE_FALLBACK_TEXT',
        sceneIndex: sceneIndexes[2],
        message: `Visible fallback/card wording repeats in scenes ${sceneIndexes.join(', ')}: "${visibleText}".`,
      });
    }
  }

  const errors = violations.filter((item) => item.level === 'error').length;
  const warnings = violations.filter((item) => item.level === 'warning').length;
  const score = Math.max(0, 100 - errors * 25 - warnings * 7);

  return {
    ok: errors === 0,
    score,
    errors,
    warnings,
    violations,
  };
}
