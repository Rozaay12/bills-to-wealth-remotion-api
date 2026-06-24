import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { type ChartPayload } from '../../lib/chartTypes';

const colors = {
  bg: '#071018',
  panel: '#0d1823',
  grid: 'rgba(148, 163, 184, 0.18)',
  text: '#f8fafc',
  muted: '#9fb0c3',
  teal: '#21c88a',
  yellow: '#ffd65a',
  red: '#ef6a5b',
  orange: '#f59f46',
  blue: '#62a8ff',
};

const palette = [colors.teal, colors.yellow, colors.red, colors.blue, colors.orange, '#a78bfa', '#f472b6', '#94a3b8'];

const money = (value: number) => {
  const prefix = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1000) return `${prefix}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}K`;
  return `${prefix}$${Math.round(abs).toLocaleString('en-US')}`;
};

const clean = (value = '') =>
  value
    .replace(/\b(?:budget_pressure|generic_debt|generic_savings|generic_credit|generic_budget|visual_intent|broll_query|chart_payload)\b/gi, '')
    .replace(/\s+#\d+\b/g, '')
    .replace(/\b([a-z]+(?:_[a-z0-9]+)+)\b/g, (_match, token: string) =>
      token
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase()),
    )
    .replace(/\s+/g, ' ')
    .trim();

const progressFor = (frame: number, start: number, duration: number) =>
  interpolate(frame, [start, start + duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

const Header: React.FC<{ title: string; subtitle?: string; emphasis?: string }> = ({ title, subtitle, emphasis }) => {
  const frame = useCurrentFrame();
  const entrance = progressFor(frame, 0, 18);
  const displayTitle = clean(title) || 'The Real Cost';
  const titleSize = displayTitle.length > 58 ? 36 : displayTitle.length > 42 ? 42 : 48;
  const displaySubtitle = clean(subtitle);
  const displayEmphasis = clean(emphasis);
  return (
    <div style={{ position: 'absolute', top: 54, left: 82, right: 82 }}>
      <div
        style={{
          height: 3,
          width: 360,
          background: `linear-gradient(90deg, ${colors.teal}, rgba(33,200,138,0))`,
          transform: `scaleX(${entrance})`,
          transformOrigin: 'left',
        }}
      />
      <div
        style={{
          marginTop: 24,
          fontFamily: 'Inter, Arial, sans-serif',
          fontSize: titleSize,
          lineHeight: 1.03,
          fontWeight: 750,
          letterSpacing: 0,
          color: colors.text,
          textTransform: 'uppercase',
          maxWidth: 860,
        }}
      >
        {displayTitle}
      </div>
      {displaySubtitle ? (
        <div
          style={{
            marginTop: 16,
            maxWidth: 760,
            fontFamily: 'Inter, Arial, sans-serif',
            fontSize: 22,
            lineHeight: 1.25,
            color: colors.muted,
          }}
        >
          {displaySubtitle}
        </div>
      ) : null}
      {displayEmphasis ? (
        <div
          style={{
            display: 'inline-flex',
            marginTop: 18,
            padding: '7px 12px',
            background: colors.red,
            color: colors.text,
            fontFamily: 'Inter, Arial, sans-serif',
            fontSize: 18,
            fontWeight: 800,
            textTransform: 'uppercase',
          }}
        >
          {displayEmphasis}
        </div>
      ) : null}
    </div>
  );
};

const BottomLine: React.FC<{ text?: string }> = ({ text }) => {
  const displayText = clean(text).slice(0, 150);
  if (!displayText) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 82,
        right: 82,
        bottom: 58,
        fontFamily: 'Inter, Arial, sans-serif',
        fontSize: displayText.length > 110 ? 21 : 24,
        lineHeight: 1.15,
        color: colors.yellow,
        fontWeight: 800,
      }}
    >
      {displayText}
    </div>
  );
};

const Background: React.FC = () => (
  <AbsoluteFill style={{ background: colors.bg }}>
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundImage:
          'linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)',
        backgroundSize: '64px 64px',
        opacity: 0.55,
      }}
    />
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(circle at 78% 20%, rgba(33,200,138,0.08), transparent 34%)',
      }}
    />
  </AbsoluteFill>
);

const Waterfall: React.FC<{ payload: ChartPayload }> = ({ payload }) => {
  const frame = useCurrentFrame();
  const values = payload.values.slice(0, 6);
  const max = Math.max(...values.map((item) => Math.abs(item.amount)), 1);
  return (
    <>
      <Header title={payload.title} subtitle={payload.subtitle} emphasis={payload.emphasis || 'Real cost'} />
      <div style={{ position: 'absolute', left: 82, right: 82, top: 250 }}>
        {values.map((item, index) => {
          const p = progressFor(frame, 22 + index * 7, 22);
          const width = interpolate(Math.abs(item.amount), [0, max], [130, 760]) * p;
          return (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
              <div
                style={{
                  width: 190,
                  color: colors.muted,
                  fontFamily: 'Inter, Arial, sans-serif',
                  fontSize: 20,
                  textTransform: 'uppercase',
                }}
              >
                {clean(item.label)}
              </div>
              <div style={{ flex: 1, height: 28, background: colors.panel, position: 'relative' }}>
                <div
                  style={{
                    width,
                    height: '100%',
                    background: palette[index % palette.length],
                    boxShadow: `0 0 24px ${palette[index % palette.length]}55`,
                  }}
                />
              </div>
              <div
                style={{
                  width: 130,
                  marginLeft: 18,
                  color: palette[index % palette.length],
                  fontFamily: 'Inter, Arial, sans-serif',
                  fontSize: 24,
                  fontWeight: 850,
                  textAlign: 'right',
                }}
              >
                {money(item.amount)}
              </div>
            </div>
          );
        })}
      </div>
      <BottomLine text={payload.voiceoverBeat || 'Small monthly payments can hide the real bill.'} />
    </>
  );
};

const PaymentStack: React.FC<{ payload: ChartPayload }> = ({ payload }) => {
  const frame = useCurrentFrame();
  const values = payload.values.slice(0, 5);
  const total = values.reduce((sum, item) => sum + Math.max(0, item.amount), 0) || 1;
  const reveal = progressFor(frame, 30, 60);
  let left = 0;
  return (
    <>
      <Header title={payload.title} subtitle={payload.subtitle} emphasis={payload.emphasis || money(total)} />
      <div style={{ position: 'absolute', left: 110, right: 110, top: 345 }}>
        <div style={{ height: 86, background: colors.panel, display: 'flex', overflow: 'hidden' }}>
          {values.map((item, index) => {
            const width = (Math.max(0, item.amount) / total) * 100 * reveal;
            const currentLeft = left;
            left += width;
            return (
              <div
                key={item.label}
                style={{
                  width: `${width}%`,
                  height: '100%',
                  background: palette[index % palette.length],
                  transformOrigin: 'left',
                }}
              >
                <div
                  style={{
                    opacity: currentLeft > 82 ? 0 : 1,
                    padding: '14px 16px',
                    color: colors.bg,
                    fontFamily: 'Inter, Arial, sans-serif',
                    fontWeight: 850,
                    fontSize: 18,
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {clean(item.label)}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 34, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
          {values.map((item, index) => (
            <div key={item.label} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ width: 14, height: 14, background: palette[index % palette.length] }} />
              <div style={{ color: colors.text, fontFamily: 'Inter, Arial, sans-serif', fontSize: 19 }}>
                {clean(item.label)} <span style={{ color: colors.muted }}>{money(item.amount)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <BottomLine text={payload.voiceoverBeat || 'The payment is only one part of the stack.'} />
    </>
  );
};

const Timeline: React.FC<{ payload: ChartPayload }> = ({ payload }) => {
  const frame = useCurrentFrame();
  const values = payload.values.slice(0, 6);
  const max = Math.max(...values.map((item) => Math.abs(item.amount)), 1);
  const points = values.map((item, index) => ({
    x: 150 + index * (860 / Math.max(values.length - 1, 1)),
    y: 500 - (Math.abs(item.amount) / max) * 260,
    item,
  }));
  const reveal = progressFor(frame, 28, 72);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  return (
    <>
      <Header title={payload.title} subtitle={payload.subtitle} emphasis={payload.emphasis || 'Compounding'} />
      <svg viewBox="0 0 1280 720" style={{ position: 'absolute', inset: 0 }}>
        {[0, 1, 2, 3].map((i) => (
          <line key={i} x1="150" x2="1010" y1={250 + i * 82} y2={250 + i * 82} stroke={colors.grid} strokeWidth="2" />
        ))}
        <path d={path} fill="none" stroke={colors.teal} strokeWidth="8" strokeLinecap="round" strokeDasharray="1200" strokeDashoffset={1200 * (1 - reveal)} />
        {points.map((point, index) => {
          const p = spring({ frame: frame - 35 - index * 8, fps: 30, config: { damping: 16, stiffness: 100 } });
          return (
            <g key={point.item.label} opacity={p}>
              <circle cx={point.x} cy={point.y} r={12 + p * 4} fill={palette[index % palette.length]} />
              <text x={point.x} y={point.y - 28} fill={colors.text} textAnchor="middle" fontFamily="Inter, Arial" fontSize="24" fontWeight="800">
                {money(point.item.amount)}
              </text>
              <text x={point.x} y="555" fill={colors.muted} textAnchor="middle" fontFamily="Inter, Arial" fontSize="18">
                {clean(point.item.label).slice(0, 16)}
              </text>
            </g>
          );
        })}
      </svg>
      <BottomLine text={payload.voiceoverBeat || 'Time is where the trap gets expensive.'} />
    </>
  );
};

const Statement: React.FC<{ payload: ChartPayload }> = ({ payload }) => {
  const frame = useCurrentFrame();
  const values = payload.values.slice(0, 5);
  const card = progressFor(frame, 24, 24);
  return (
    <>
      <Header title={payload.title} subtitle={payload.subtitle} emphasis={payload.emphasis || 'Statement'} />
      <div
        style={{
          position: 'absolute',
          left: 330,
          top: 235,
          width: 620,
          height: 330,
          background: '#f8fafc',
          color: '#111827',
          transform: `translateY(${(1 - card) * 24}px) scale(${0.96 + card * 0.04})`,
          opacity: card,
          boxShadow: '0 22px 80px rgba(0,0,0,0.42)',
        }}
      >
        <div style={{ height: 54, background: '#e5e7eb', display: 'flex', alignItems: 'center', padding: '0 28px', fontFamily: 'Inter, Arial', fontWeight: 850, fontSize: 20 }}>
          ACCOUNT STATEMENT
        </div>
        <div style={{ padding: '26px 34px' }}>
          {values.map((item, index) => {
            const reveal = progressFor(frame, 42 + index * 8, 18);
            return (
              <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #d1d5db', padding: '14px 0', opacity: reveal }}>
                <span style={{ fontFamily: 'Inter, Arial', fontSize: 22 }}>{clean(item.label)}</span>
                <span style={{ fontFamily: 'Inter, Arial', fontSize: 24, fontWeight: 850, color: index === 0 ? colors.red : '#111827' }}>{money(item.amount)}</span>
              </div>
            );
          })}
        </div>
      </div>
      <BottomLine text={payload.voiceoverBeat || 'The statement shows the part the pitch hides.'} />
    </>
  );
};

const FeeExplosion: React.FC<{ payload: ChartPayload }> = ({ payload }) => {
  const frame = useCurrentFrame();
  const total = payload.values.reduce((sum, item) => sum + Math.max(0, item.amount), 0);
  const pop = spring({ frame: frame - 24, fps: 30, config: { damping: 12, stiffness: 120 } });
  return (
    <>
      <Header title={payload.title} subtitle={payload.subtitle} emphasis={payload.emphasis || 'Fees'} />
      <div
        style={{
          position: 'absolute',
          left: 82,
          right: 82,
          top: 280,
          textAlign: 'center',
          fontFamily: 'Inter, Arial, sans-serif',
          fontSize: 118,
          fontWeight: 900,
          color: colors.red,
          transform: `scale(${0.75 + pop * 0.25})`,
        }}
      >
        {money(total)}
      </div>
      {payload.values.slice(0, 6).map((item, index) => {
        const reveal = spring({ frame: frame - 55 - index * 6, fps: 30, config: { damping: 14 } });
        const positions = [
          { left: 185, top: 470 },
          { left: 390, top: 525 },
          { left: 645, top: 540 },
          { left: 895, top: 525 },
          { left: 1095, top: 470 },
          { left: 640, top: 430 },
        ];
        const position = positions[index] || positions[0];
        return (
          <div
            key={item.label}
            style={{
              position: 'absolute',
              left: position.left,
              top: position.top,
              padding: '10px 16px',
              background: palette[index % palette.length],
              color: index === 1 ? '#111827' : colors.text,
              fontFamily: 'Inter, Arial',
              fontWeight: 850,
              fontSize: 19,
              opacity: reveal,
              textTransform: 'uppercase',
              transform: `translate(-50%, -50%) scale(${0.94 + reveal * 0.06})`,
              maxWidth: 230,
              whiteSpace: 'nowrap',
            }}
          >
            {clean(item.label)} {money(item.amount)}
          </div>
        );
      })}
      <BottomLine text={payload.voiceoverBeat || 'Fees turn a small mistake into a bigger bill.'} />
    </>
  );
};

const BeforeAfter: React.FC<{ payload: ChartPayload }> = ({ payload }) => {
  const frame = useCurrentFrame();
  const before = payload.values[0]?.amount ?? 0;
  const after = payload.values[1]?.amount ?? before;
  const max = Math.max(Math.abs(before), Math.abs(after), 1);
  const p = progressFor(frame, 34, 54);
  return (
    <>
      <Header title={payload.title} subtitle={payload.subtitle} emphasis={payload.emphasis || 'Before / After'} />
      <div style={{ position: 'absolute', left: 150, right: 150, top: 300, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 52 }}>
        {[
          { label: payload.values[0]?.label || 'Before', value: before, color: colors.red },
          { label: payload.values[1]?.label || 'After', value: after, color: colors.teal },
        ].map((item) => (
          <div key={item.label} style={{ background: colors.panel, height: 210, padding: 28, position: 'relative' }}>
            <div style={{ fontFamily: 'Inter, Arial', fontSize: 24, color: colors.muted, textTransform: 'uppercase' }}>{clean(item.label)}</div>
            <div style={{ marginTop: 30, height: 34, background: '#101d2a' }}>
              <div style={{ width: `${(Math.abs(item.value) / max) * 100 * p}%`, height: '100%', background: item.color }} />
            </div>
            <div style={{ position: 'absolute', right: 28, bottom: 26, fontFamily: 'Inter, Arial', fontSize: 54, fontWeight: 900, color: item.color }}>
              {money(item.value)}
            </div>
          </div>
        ))}
      </div>
      <BottomLine text={payload.voiceoverBeat || 'The decision changes the cash flow.'} />
    </>
  );
};

export const FinanceChart: React.FC<ChartPayload> = (props) => {
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ width, height, overflow: 'hidden', background: colors.bg }}>
      <Background />
      {props.chartType === 'debt_waterfall' ? <Waterfall payload={props} /> : null}
      {props.chartType === 'payment_stack' ? <PaymentStack payload={props} /> : null}
      {props.chartType === 'interest_trap_timeline' ? <Timeline payload={props} /> : null}
      {props.chartType === 'statement_breakdown' ? <Statement payload={props} /> : null}
      {props.chartType === 'fee_explosion' ? <FeeExplosion payload={props} /> : null}
      {props.chartType === 'before_after_cashflow' ? <BeforeAfter payload={props} /> : null}
    </AbsoluteFill>
  );
};
