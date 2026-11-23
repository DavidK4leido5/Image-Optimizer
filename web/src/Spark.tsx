import type { Point } from './api';

type Props = { points: Point[]; color: string };

export function Spark({ points, color }: Props) {
  const width = 320;
  const height = 72;

  if (points.length < 2) return <div className="spark-empty">no data yet</div>;

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;

  const path = points
    .map(([x, y], index) => {
      const px = ((x - minX) / spanX) * width;
      const py = height - 6 - ((y - minY) / spanY) * (height - 12);
      return (index === 0 ? 'M' : 'L') + px.toFixed(1) + ',' + py.toFixed(1);
    })
    .join(' ');

  return (
    <svg className="spark" viewBox={'0 0 ' + width + ' ' + height} preserveAspectRatio="none">
      <path d={path} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
