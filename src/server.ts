import { bundle } from '@remotion/bundler';
import { getCompositions, renderMedia } from '@remotion/renderer';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chartPayloadSchema, chartTypeDescriptions, chartTypes } from './lib/chartTypes.js';
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

  const payload = parsed.data;
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
