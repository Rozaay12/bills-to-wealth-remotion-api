import { bundle } from '@remotion/bundler';
import { getCompositions, renderMedia } from '@remotion/renderer';
import express from 'express';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chartPayloadSchema, chartTypeDescriptions, chartTypes, type ChartPayload } from './lib/chartTypes.js';
import { validateVisualPlan } from './lib/planQa.js';
import { planVideoVisuals, type BrollClip } from './lib/visualPlanner.js';

const app = express();
const port = Number(process.env.PORT || 10000);
const host = process.env.HOST;
const renderDir = process.env.RENDER_STORAGE_DIR || path.join(process.cwd(), 'renders');
const apiToken = process.env.API_TOKEN || '';
const remotionEntryPoint = path.join(process.cwd(), 'src/remotion/index.ts');

app.set('trust proxy', true);
app.use(express.json({ limit: '12mb' }));

let bundlePromise: Promise<string> | null = null;
let renderQueue = Promise.resolve();
const metadataCache = new Map<string, { clips: BrollClip[]; loadedAt: number }>();

async function getBundleLocation() {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: remotionEntryPoint,
      webpackOverride: (config) => config,
    });
  }
  return bundlePromise;
}

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!apiToken) return next();
  const header = req.header('authorization') || '';
  if (header !== `Bearer ${apiToken}`) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  next();
}

function publicBaseUrl(req: express.Request) {
  const configured = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
  if (configured) return configured;
  return `${req.protocol}://${req.get('host')}`;
}

function driveDownloadUrl(url: string) {
  const fileId = url.match(/\/d\/([^/]+)/)?.[1] || url.match(/[?&]id=([^&]+)/)?.[1];
  if (!fileId) return url;
  return `https://drive.google.com/uc?id=${encodeURIComponent(fileId)}&export=download`;
}

const titleCase = (value = '') =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

function hasInternalVisibleLabel(value = '') {
  const normalized = value.toLowerCase();
  if (/\b(?:budget_pressure|generic_debt|generic_savings|generic_credit|generic_budget|visual_intent|broll_query|chart_payload)\b/.test(normalized)) {
    return true;
  }
  if (/\b[a-z]+_[a-z0-9_]+\b/.test(value)) return true;
  if (/\s+#\d+\b/.test(value)) return true;
  return false;
}

function cleanVisibleText(value = '', fallback = '') {
  const replacements: Record<string, string> = {
    budget_pressure: 'monthly budget pressure',
    generic_debt: 'debt pressure',
    generic_savings: 'savings buffer',
    generic_credit: 'credit pressure',
    generic_budget: 'monthly budget',
    visual_intent: '',
    broll_query: '',
    chart_payload: '',
  };
  let cleaned = String(value || '');
  for (const [token, replacement] of Object.entries(replacements)) {
    cleaned = cleaned.replace(new RegExp(`\\b${token}\\b`, 'gi'), replacement);
  }
  cleaned = cleaned
    .replace(/\s+#\d+\b/g, '')
    .replace(/\b([a-z]+(?:_[a-z0-9]+)+)\b/g, (_match, token: string) => titleCase(token))
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function firstSentence(value = '') {
  return cleanVisibleText(value.split(/(?<=[.!?])\s+/)[0] || value).slice(0, 140);
}

function editorialChartTitle(chartType: string, voiceover = '') {
  if (/\b(overdraft|declined|pending|low balance|bank app|debit)\b/i.test(voiceover)) {
    if (chartType === 'fee_explosion') return 'When The Fee Hits';
    if (chartType === 'before_after_cashflow') return 'The Buffer That Stops The Fee';
    return 'Why The Balance Was Wrong';
  }
  if (/\b(refund|banks?|bureau|consumer)\b/i.test(voiceover)) return 'What Banks Had To Refund';
  if (/\b(car|vehicle|dealer|loan)\b/i.test(voiceover)) return 'The Real Cost Of The Car';
  if (/\b(grocery|checkout|receipt)\b/i.test(voiceover)) return 'The Checkout Trap';
  if (chartType === 'fee_explosion') return 'Small Fees Become Real Money';
  if (chartType === 'statement_breakdown') return 'The Statement Shows The Trap';
  if (chartType === 'before_after_cashflow') return 'Before And After The Decision';
  if (chartType === 'interest_trap_timeline') return 'The Cost Grows Over Time';
  return 'The Real Monthly Cost';
}

function sanitizeChartPayload(payload: ChartPayload): ChartPayload {
  const voiceoverBeat = firstSentence(payload.voiceoverBeat || payload.subtitle || payload.title);
  const title = cleanVisibleText(payload.title);
  const titleLooksInternal =
    !title ||
    hasInternalVisibleLabel(payload.title) ||
    /\b(?:bill zoom in|savings buffer)\b.*#?\d*/i.test(payload.title);
  const subtitle = cleanVisibleText(payload.subtitle || '');
  const emphasis = cleanVisibleText(payload.emphasis || '');

  return {
    ...payload,
    title: titleLooksInternal ? editorialChartTitle(payload.chartType, voiceoverBeat) : title.slice(0, 92),
    subtitle: subtitle && !hasInternalVisibleLabel(payload.subtitle || '') ? subtitle.slice(0, 140) : undefined,
    values: payload.values.map((item) => ({
      ...item,
      label: cleanVisibleText(item.label, 'Cost').slice(0, 44),
      note: item.note ? cleanVisibleText(item.note).slice(0, 80) : undefined,
    })),
    voiceoverBeat,
    emphasis: emphasis && !hasInternalVisibleLabel(payload.emphasis || '') ? emphasis.slice(0, 80) : undefined,
  };
}

function runCommand(command: string, args: string[], timeoutMs = 90000) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function parseRanges(output: string, name: string) {
  const regex = new RegExp(`${name}_start:([0-9.]+)\\s+${name}_end:([0-9.]+)\\s+${name}_duration:([0-9.]+)`, 'g');
  return Array.from(output.matchAll(regex)).map((match) => ({
    start: Number(match[1]),
    end: Number(match[2]),
    duration: Number(match[3]),
  }));
}

function clipsFromPayload(body: Record<string, unknown>): BrollClip[] {
  if (Array.isArray(body.brollLibrary)) return body.brollLibrary as BrollClip[];
  if (Array.isArray(body.clips)) return body.clips as BrollClip[];
  const metadata = body.brollMetadata as { clips?: unknown } | undefined;
  if (metadata && Array.isArray(metadata.clips)) return metadata.clips as BrollClip[];
  return [];
}

async function clipsFromUrl(url: string): Promise<BrollClip[]> {
  const normalizedUrl = driveDownloadUrl(url);
  const cached = metadataCache.get(normalizedUrl);
  if (cached && Date.now() - cached.loadedAt < 1000 * 60 * 30) return cached.clips;

  const response = await fetch(normalizedUrl);
  if (!response.ok) {
    throw new Error(`Failed to load b-roll metadata: ${response.status} ${response.statusText}`);
  }
  const json = (await response.json()) as { clips?: BrollClip[] } | BrollClip[];
  const clips = Array.isArray(json) ? json : Array.isArray(json.clips) ? json.clips : [];
  metadataCache.set(normalizedUrl, { clips, loadedAt: Date.now() });
  return clips;
}

async function loadBrollClips(body: Record<string, unknown>) {
  const inlineClips = clipsFromPayload(body);
  if (inlineClips.length) return inlineClips;

  const url = typeof body.brollMetadataUrl === 'string' ? body.brollMetadataUrl : process.env.BROLL_METADATA_URL;
  if (!url) return [];
  return clipsFromUrl(url);
}

function enqueueRender<T>(task: () => Promise<T>) {
  const run = renderQueue.then(task, task);
  renderQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function cleanupOldRenders() {
  const files = await fs.readdir(renderDir).catch(() => []);
  const mp4s = files.filter((file) => file.endsWith('.mp4'));
  if (mp4s.length <= 40) return;
  const withStats = await Promise.all(
    mp4s.map(async (file) => ({
      file,
      stat: await fs.stat(path.join(renderDir, file)),
    })),
  );
  withStats
    .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)
    .slice(0, Math.max(0, withStats.length - 40))
    .forEach((item) => {
      void fs.unlink(path.join(renderDir, item.file)).catch(() => undefined);
    });
}

app.get('/health', async (_req, res) => {
  res.json({
    ok: true,
    service: 'bills-to-wealth-remotion-api',
    version: '0.1.0',
    chartTypes,
  });
});

app.get('/chart-types', (_req, res) => {
  res.json({
    ok: true,
    chartTypes: chartTypes.map((type) => ({
      type,
      description: chartTypeDescriptions[type],
    })),
  });
});

app.post('/validate-plan', requireAuth, (req, res) => {
  const scenes = Array.isArray(req.body?.scenes) ? req.body.scenes : [];
  const result = validateVisualPlan(scenes);
  res.status(result.ok ? 200 : 422).json(result);
});

app.post('/plan-video', requireAuth, async (req, res) => {
  const body = (req.body || {}) as Record<string, unknown>;
  const scenes = Array.isArray(body.scenes)
    ? body.scenes
    : Array.isArray(body.timeline)
      ? body.timeline
      : [];

  if (!scenes.length) {
    res.status(400).json({
      ok: false,
      error: 'Missing scenes. Send { scenes: [{ sceneIndex, narration, duration }] }.',
    });
    return;
  }

  try {
    const clips = await loadBrollClips(body);
    const result = planVideoVisuals(scenes, clips, {
      ...(typeof body.options === 'object' && body.options ? body.options : {}),
    });
    res.status(result.ok ? 200 : 422).json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/render-chart', requireAuth, async (req, res) => {
  const parsed = chartPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: 'Invalid chart payload',
      issues: parsed.error.issues,
    });
    return;
  }

  const payload = sanitizeChartPayload(parsed.data);
  const fingerprint = crypto
    .createHash('sha1')
    .update(JSON.stringify({
      chartType: payload.chartType,
      title: payload.title,
      values: payload.values,
      duration: payload.duration,
      style: payload.style,
    }))
    .digest('hex')
    .slice(0, 18);

  const filename = `${Date.now()}-${fingerprint}.mp4`;
  const outputLocation = path.join(renderDir, filename);
  const durationInFrames = Math.round(payload.duration * 30);

  try {
    await fs.mkdir(renderDir, { recursive: true });
    await enqueueRender(async () => {
      const serveUrl = await getBundleLocation();
      const compositions = await getCompositions(serveUrl, { inputProps: payload });
      const composition = compositions.find((item) => item.id === 'FinanceChart');
      if (!composition) throw new Error('FinanceChart composition was not found.');
      await renderMedia({
        composition: {
          ...composition,
          durationInFrames,
        },
        serveUrl,
        codec: 'h264',
        outputLocation,
        inputProps: payload,
      });
    });
    await cleanupOldRenders();
    res.json({
      ok: true,
      renderId: filename.replace(/\.mp4$/, ''),
      chartType: payload.chartType,
      fingerprint,
      duration: payload.duration,
      videoUrl: `${publicBaseUrl(req)}/renders/${filename}`,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/qa-render', requireAuth, async (req, res) => {
  const videoUrl = typeof req.body?.videoUrl === 'string' ? req.body.videoUrl : '';
  if (!videoUrl) {
    res.status(400).json({ ok: false, error: 'Missing videoUrl.' });
    return;
  }

  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
  const tmpPath = path.join(os.tmpdir(), `btw-render-qa-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.mp4`);

  try {
    const response = await fetch(videoUrl);
    if (!response.ok) throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
    await fs.writeFile(tmpPath, Buffer.from(await response.arrayBuffer()));

    const durationResult = await runCommand(ffprobe, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nokey=1:noprint_wrappers=1',
      tmpPath,
    ], 30000);
    const duration = Number(durationResult.stdout.trim());

    const blackResult = await runCommand(ffmpeg, [
      '-hide_banner',
      '-i',
      tmpPath,
      '-vf',
      'blackdetect=d=0.25:pix_th=0.10',
      '-an',
      '-f',
      'null',
      '-',
    ]);
    const silenceResult = await runCommand(ffmpeg, [
      '-hide_banner',
      '-i',
      tmpPath,
      '-af',
      'silencedetect=noise=-45dB:d=0.4',
      '-f',
      'null',
      '-',
    ]);
    const freezeResult = await runCommand(ffmpeg, [
      '-hide_banner',
      '-i',
      tmpPath,
      '-vf',
      'freezedetect=n=-60dB:d=5',
      '-an',
      '-f',
      'null',
      '-',
    ]);

    const blackRanges = parseRanges(blackResult.stderr, 'black');
    const silenceRanges = parseRanges(silenceResult.stderr, 'silence');
    const freezeRanges = parseRanges(freezeResult.stderr, 'freeze');
    const violations: Array<{ level: 'error' | 'warning'; code: string; message: string; range?: unknown }> = [];

    for (const range of blackRanges) {
      const isTail = Number.isFinite(duration) && duration - range.end < 0.7;
      if (isTail && range.duration > 0.5) {
        violations.push({ level: 'error', code: 'BLACK_TAIL', message: `Black tail lasts ${range.duration.toFixed(2)}s.`, range });
      } else if (range.duration > 0.75) {
        violations.push({ level: 'error', code: 'BLACK_GAP', message: `Black screen gap lasts ${range.duration.toFixed(2)}s.`, range });
      }
    }

    for (const range of silenceRanges) {
      const isTail = Number.isFinite(duration) && duration - range.end < 0.7;
      if (isTail && range.duration > 1.25) {
        violations.push({ level: 'error', code: 'SILENT_TAIL', message: `Silent tail lasts ${range.duration.toFixed(2)}s.`, range });
      } else if (range.duration > 1.5) {
        violations.push({ level: 'warning', code: 'LONG_SILENCE', message: `Silence lasts ${range.duration.toFixed(2)}s.`, range });
      }
    }

    for (const range of freezeRanges) {
      const isTail = Number.isFinite(duration) && duration - range.end < 0.7;
      if (!isTail && range.duration > 8) {
        violations.push({ level: 'warning', code: 'LONG_FREEZE', message: `Static frame lasts ${range.duration.toFixed(2)}s.`, range });
      }
    }

    const errors = violations.filter((item) => item.level === 'error').length;
    res.status(errors ? 422 : 200).json({
      ok: errors === 0,
      duration,
      blackRanges,
      silenceRanges,
      freezeRanges,
      errors,
      warnings: violations.length - errors,
      violations,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      hint: 'Set FFMPEG_PATH and FFPROBE_PATH in Render if the service cannot find ffmpeg.',
    });
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
});

app.use('/renders', express.static(renderDir, {
  fallthrough: false,
  setHeaders: (res) => {
    res.setHeader('cache-control', 'public, max-age=86400');
  },
}));

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

const server = host
  ? app.listen(port, host, onListening)
  : app.listen(port, onListening);

server.on('error', (error) => {
  console.error('Failed to start server:', error);
  process.exitCode = 1;
});

async function onListening() {
  await fs.mkdir(renderDir, { recursive: true });
  console.log(`Bills To Wealth Remotion API listening on ${host || '0.0.0.0'}:${port}`);
}
