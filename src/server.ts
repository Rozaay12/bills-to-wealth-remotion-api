import { bundle } from '@remotion/bundler';
import { getCompositions, renderMedia } from '@remotion/renderer';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chartPayloadSchema, chartTypeDescriptions, chartTypes } from './lib/chartTypes.js';
import { validateVisualPlan } from './lib/planQa.js';

const app = express();
const port = Number(process.env.PORT || 10000);
const host = process.env.HOST;
const renderDir = process.env.RENDER_STORAGE_DIR || path.join(process.cwd(), 'renders');
const apiToken = process.env.API_TOKEN || '';
const remotionEntryPoint = path.join(process.cwd(), 'src/remotion/index.ts');

app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

let bundlePromise: Promise<string> | null = null;
let renderQueue = Promise.resolve();

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
