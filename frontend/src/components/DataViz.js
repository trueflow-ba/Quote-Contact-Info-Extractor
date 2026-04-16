import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { MapPin, Map } from 'lucide-react';

const COLORS = ['#0EA5E9', '#38BDF8', '#7DD3FC', '#0284C7', '#0369A1', '#075985', '#BAE6FD', '#06B6D4', '#22D3EE', '#67E8F9'];
const STATE_COLORS = ['#F59E0B', '#FBBF24', '#FCD34D', '#D97706', '#B45309', '#92400E', '#FDE68A', '#F97316', '#FB923C', '#FDBA74'];

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#111827] border border-slate-700 rounded-sm px-3 py-2 shadow-lg">
      <p className="text-xs text-slate-300 font-medium">{label}</p>
      <p className="text-sm font-semibold text-sky-400">{payload[0].value} contacts</p>
    </div>
  );
}

function ChartCard({ title, icon: Icon, iconColor, data, barColors, emptyText }) {
  if (!data?.length) {
    return (
      <div className="bg-[#111827] border border-slate-800 rounded-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <Icon className={`h-4 w-4 ${iconColor}`} strokeWidth={1.5} />
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">{title}</h3>
        </div>
        <p className="text-sm text-slate-600 text-center py-8">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="bg-[#111827] border border-slate-800 rounded-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${iconColor}`} strokeWidth={1.5} />
          <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">{title}</h3>
        </div>
        <span className="text-xs text-slate-500">{data.length} locations</span>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 32)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" horizontal={false} />
          <XAxis type="number" tick={{ fill: '#64748B', fontSize: 11 }} axisLine={{ stroke: '#1E293B' }} tickLine={false} />
          <YAxis
            dataKey="name"
            type="category"
            tick={{ fill: '#94A3B8', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={100}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(14,165,233,0.05)' }} />
          <Bar dataKey="count" radius={[0, 2, 2, 0]} maxBarSize={20}>
            {data.map((_, i) => (
              <Cell key={i} fill={barColors[i % barColors.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function DataViz({ chartData }) {
  const cityData = useMemo(() => chartData?.by_city || [], [chartData]);
  const stateData = useMemo(() => chartData?.by_state || [], [chartData]);

  if (!cityData.length && !stateData.length) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" data-testid="data-viz-container">
      <ChartCard
        title="Contacts by City"
        icon={MapPin}
        iconColor="text-sky-400"
        data={cityData}
        barColors={COLORS}
        emptyText="No city data available"
      />
      <ChartCard
        title="Contacts by State"
        icon={Map}
        iconColor="text-amber-400"
        data={stateData}
        barColors={STATE_COLORS}
        emptyText="No state data available"
      />
    </div>
  );
}
