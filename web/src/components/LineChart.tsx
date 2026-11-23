import { useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Point } from '../types';

export type LineChartProps = {
  points: Point[];
  unit: string;
  label: string;
  tone?: 'accent' | 'ok' | 'warn' | 'danger';
  height?: number;
  id: string;
};

// Left gutter holds the y ticks, the band under the plot holds the time labels.
const GUTTER = 34;
const TIME_BAND = 16;
const PAD = 2;
const DIGITS: Record<string, number> = { cores: 3, MB: 1, 'req/s': 2, ms: 0 };

function clock(seconds: number): string {
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '--:--';
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

export function LineChart({ points, unit, label, tone = 'accent', height = 96, id }: LineChartProps): JSX.Element {
  const [active, setActive] = useState<number | null>(null);

  const digits = DIGITS[unit] ?? 2;
  const stroke = 'var(--' + tone + ')';
  const format = (value: number) => value.toFixed(digits) + ' ' + unit;
  const data = points.filter(([time, value]) => Number.isFinite(time) && Number.isFinite(value));

  if (data.length < 2) {
    return (
      <div
        className="line-chart line-chart__empty"
        id={id}
        role="img"
        aria-label={label + ': not enough data yet'}
        style={{
          height,
          boxSizing: 'border-box',
          display: 'grid',
          placeItems: 'center',
          border: '1px dashed var(--line-strong)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--text-subtle)',
          fontSize: 'var(--text-xs)',
        }}
      >
        Not enough data yet
      </div>
    );
  }

  const first = data[0];
  const last = data[data.length - 1];
  const values = data.map(([, value]) => value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  // A flat series still needs a non-zero range.
  const grow = high - low > 0 ? 0 : Math.abs(high) * 0.1 || 1;
  const yMin = low - grow;
  const yMax = high + grow;
  const ySpan = yMax - yMin;
  const t0 = first[0];
  const tSpan = last[0] - t0 || 1;
  const plotH = Math.max(height - TIME_BAND, 24);
  const xFor = (time: number) => ((time - t0) / tSpan) * 100;
  const yFor = (value: number) => PAD + (1 - (value - yMin) / ySpan) * (plotH - PAD * 2);
  const ticks = [yMax, (yMax + yMin) / 2, yMin];
  const path = data.map(([time, value]) => xFor(time).toFixed(2) + ',' + yFor(value).toFixed(2)).join(' ');
  // Points can shrink between polls, so clamp the stored index before use.
  const shown = active !== null && active < data.length ? data[active] : null;

  const pick = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const time = t0 + ((event.clientX - box.left) / box.width) * tSpan;
    let nearest = 0;
    for (let index = 1; index < data.length; index += 1) {
      if (Math.abs(data[index][0] - time) < Math.abs(data[nearest][0] - time)) nearest = index;
    }
    setActive(nearest);
  };

  const step = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      setActive(null);
      return;
    }
    const end = data.length - 1;
    const from = Math.min(active ?? end, end);
    const next =
      event.key === 'ArrowRight' ? Math.min(from + 1, end)
      : event.key === 'ArrowLeft' ? Math.max(from - 1, 0)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? end
      : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  };

  const summary = label + ': latest ' + format(last[1]) + ', min ' + format(low) + ', max ' + format(high);

  return (
    <div
      className="line-chart"
      id={id}
      role="img"
      tabIndex={0}
      aria-label={summary}
      aria-describedby={id + '-summary'}
      onKeyDown={step}
      onPointerLeave={() => setActive(null)}
      style={{ position: 'relative', height, width: '100%', color: 'var(--text-subtle)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'tabular-nums' }}
    >
      {ticks.map((tick, index) => (
        <span
          key={index}
          className="line-chart__axis"
          aria-hidden="true"
          style={{ position: 'absolute', left: 0, top: yFor(tick), width: GUTTER - 6, textAlign: 'right', transform: 'translateY(-50%)', lineHeight: 1 }}
        >
          {tick.toFixed(digits)}
        </span>
      ))}

      <div
        className="line-chart__plot"
        onPointerMove={pick}
        onPointerDown={pick}
        style={{ position: 'absolute', left: GUTTER, right: 0, top: 0, height: plotH }}
      >
        <svg
          className="line-chart__svg"
          viewBox={'0 0 100 ' + plotH}
          preserveAspectRatio="none"
          aria-hidden="true"
          style={{ display: 'block', width: '100%', height: '100%' }}
        >
          <g className="line-chart__grid" stroke="var(--line)" strokeWidth={1}>
            {ticks.map((tick, index) => (
              <line key={index} x1={0} x2={100} y1={yFor(tick)} y2={yFor(tick)} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
          <polyline
            className="line-chart__line"
            points={path}
            fill="none"
            stroke={stroke}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {shown && (
          <>
            <span
              className="line-chart__cursor"
              aria-hidden="true"
              style={{ position: 'absolute', top: 0, bottom: 0, left: xFor(shown[0]) + '%', width: 1, background: 'var(--line-strong)' }}
            />
            <span
              className="line-chart__dot"
              aria-hidden="true"
              style={{ position: 'absolute', left: xFor(shown[0]) + '%', top: yFor(shown[1]), width: 7, height: 7, marginLeft: -3.5, marginTop: -3.5, borderRadius: '50%', background: stroke }}
            />
            <span
              className="line-chart__tooltip"
              aria-hidden="true"
              style={{ position: 'absolute', left: xFor(shown[0]) + '%', top: yFor(shown[1]) - 10, transform: 'translate(-50%, -100%)', whiteSpace: 'nowrap', padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', border: '1px solid var(--line)', color: 'var(--text)' }}
            >
              <time>{clock(shown[0])}</time> {format(shown[1])}
            </span>
          </>
        )}
      </div>

      <span className="line-chart__axis" aria-hidden="true" style={{ position: 'absolute', left: GUTTER, bottom: 0 }}>
        <time>{clock(first[0])}</time>
      </span>
      <span className="line-chart__axis" aria-hidden="true" style={{ position: 'absolute', right: 0, bottom: 0 }}>
        <time>{clock(last[0])}</time>
      </span>

      <p
        className="line-chart__label"
        id={id + '-summary'}
        style={{ position: 'absolute', width: 1, height: 1, margin: -1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' }}
      >
        {label + ' in ' + unit + ', ' + data.length + ' points from ' + clock(first[0]) + ' to ' + clock(last[0])
          + '. Latest ' + format(last[1]) + ', minimum ' + format(low) + ', maximum ' + format(high)
          + '. Use the arrow keys to step through the points.'}
      </p>
    </div>
  );
}
