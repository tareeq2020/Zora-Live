import Svg, { Polyline } from 'react-native-svg';
import { useZ } from '../theme';

export default function Sparkline({
  data, width = 300, height = 50, color,
}: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const z = useZ();
  const stroke = color ?? z.ultra;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = width / Math.max(1, data.length - 1);
  const points = data
    .map((v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / range) * (height - 6) - 3).toFixed(1)}`)
    .join(' ');
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <Polyline points={points} fill="none" stroke={stroke} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}
