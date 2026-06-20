# Bills To Wealth Remotion API

Animated finance chart API for Bills To Wealth videos.

This service gives n8n a simple HTTP API for creating short animated finance chart clips. n8n sends JSON chart data, Remotion renders an MP4, and the API returns a public video URL that can be passed into Creatomate.

## Endpoints

### `GET /health`

Returns service status and available chart types.

### `GET /chart-types`

Returns supported animated chart styles:

- `debt_waterfall`
- `payment_stack`
- `interest_trap_timeline`
- `statement_breakdown`
- `fee_explosion`
- `before_after_cashflow`

### `POST /validate-plan`

Checks a planned video for repeated b-roll, repeated fingerprints, repeated chart styles, and overused search queries.

### `POST /render-chart`

Renders one animated chart clip.

Example body:

```json
{
  "chartType": "debt_waterfall",
  "title": "The Real Cost Of A $450 Payment",
  "subtitle": "One monthly number hides the rest of the trap.",
  "values": [
    { "label": "Car payment", "amount": 450 },
    { "label": "Insurance", "amount": 180 },
    { "label": "Gas", "amount": 220 },
    { "label": "Maintenance", "amount": 95 },
    { "label": "Fees", "amount": 60 }
  ],
  "duration": 5,
  "voiceoverBeat": "That payment is only the first number.",
  "emphasis": "Real cost"
}
```

Example response:

```json
{
  "ok": true,
  "renderId": "1780000000000-abc123",
  "chartType": "debt_waterfall",
  "fingerprint": "abc123",
  "duration": 5,
  "videoUrl": "https://your-service.onrender.com/renders/1780000000000-abc123.mp4"
}
```

## Environment Variables

```text
API_TOKEN=private-token-used-by-n8n
NODE_ENV=production
RENDER_STORAGE_DIR=/tmp/bills-to-wealth-renders
PUBLIC_BASE_URL=https://your-service.onrender.com
```

`API_TOKEN` is optional locally. Set it on Render before connecting n8n.

## Local Development

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:10000/health
```

Render a sample chart:

```bash
curl -X POST http://localhost:10000/render-chart \
  -H "Content-Type: application/json" \
  --data @samples/render-chart.json
```

Validate a planned video:

```bash
curl -X POST http://localhost:10000/validate-plan \
  -H "Content-Type: application/json" \
  --data @samples/validate-plan.json
```

## Render Deployment

Use these settings:

```text
Runtime: Node
Build Command: npm install && npm run build
Start Command: npm start
Plan: Standard recommended
```

The included `render.yaml` can also be used as a blueprint.

## n8n Usage

Use an HTTP Request node:

```text
Method: POST
URL: https://your-service.onrender.com/render-chart
Authentication: None
Header: Authorization = Bearer YOUR_API_TOKEN
Header: Content-Type = application/json
Body: JSON
```

The returned `videoUrl` should be added to the Creatomate dynamic source as a video element.
