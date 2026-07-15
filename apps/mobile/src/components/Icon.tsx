import React from 'react';
import Svg, { Path, Circle, Rect } from 'react-native-svg';

const icons: Record<string, React.ReactNode> = {
  home: <Path d="M3 13.5 12 5l9 8.5M5 12v7h14v-7" />,
  ticket: <Path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4Z" />,
  person: (<><Circle cx={12} cy={8} r={3.4} /><Path d="M5 20a7 7 0 0 1 14 0" /></>),
  grid: (<><Rect x={3} y={3} width={8} height={10} rx={1.5} /><Rect x={13} y={3} width={8} height={6} rx={1.5} /><Rect x={13} y={11} width={8} height={10} rx={1.5} /><Rect x={3} y={15} width={8} height={6} rx={1.5} /></>),
  wallet: (<><Rect x={3} y={6} width={18} height={13} rx={2.5} /><Path d="M3 10h18" /></>),
  people: (<><Circle cx={9} cy={8} r={3.2} /><Path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><Path d="M16 5.5a3 3 0 0 1 0 5.8" /></>),
  shield: (<><Path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6Z" /><Path d="m9 12 2 2 4-4" /></>),
  gear: (<><Circle cx={12} cy={12} r={3} /><Path d="M19.4 13a7.9 7.9 0 0 0 0-2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1l-.4-2.6h-4l-.4 2.6a7 7 0 0 0-1.7 1l-2.3-1-2 3.4L4.6 11a7.9 7.9 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7 7 0 0 0 1.7-1l2.3 1 2-3.4Z" /></>),
};

export default function Icon({ name, color, size = 22 }: { name: string; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {icons[name]}
    </Svg>
  );
}
