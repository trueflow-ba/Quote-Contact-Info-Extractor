import { FileText, AlertTriangle, CheckCircle, Users, MinusCircle, Copy, Ban, TrendingUp, GitMerge } from 'lucide-react';

const statConfig = [
  { key: 'total_pdfs', label: 'Total PDFs', icon: FileText, color: 'text-sky-400' },
  { key: 'processed', label: 'Processed', icon: CheckCircle, color: 'text-emerald-400' },
  { key: 'errors', label: 'Errors', icon: AlertTriangle, color: 'text-red-400' },
  { key: 'net_new', label: 'Net New Contacts', icon: TrendingUp, color: 'text-amber-400' },
];

const detailStats = [
  { key: 'contacts_extracted', label: 'Total Extracted', icon: Users },
  { key: 'duplicates_removed', label: 'Duplicates (all)', icon: Copy },
  { key: 'cross_run_duplicates', label: 'Already in Prior Runs', icon: GitMerge },
  { key: 'excluded_no_contact', label: 'No Contact Info', icon: MinusCircle },
  { key: 'excluded_internal', label: 'Internal Excluded', icon: Ban },
];

export default function StatsCards({ stats }) {
  const s = stats || {};

  return (
    <div data-testid="stats-cards">
      {/* Primary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {statConfig.map(({ key, label, icon: Icon, color }) => (
          <div key={key} className="bg-[#111827] border border-slate-800 rounded-sm p-4 hover:border-slate-700 transition-colors">
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`h-4 w-4 ${color}`} strokeWidth={1.5} />
              <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
            </div>
            <p className={`text-2xl font-semibold ${color}`}>{s[key] ?? '-'}</p>
          </div>
        ))}
      </div>

      {/* Detail stats row */}
      {s.contacts_extracted > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4 mt-3">
          {detailStats.map(({ key, label, icon: Icon }) => (
            <div key={key} className="bg-[#111827]/50 border border-slate-800/50 rounded-sm px-4 py-3 flex items-center gap-3">
              <Icon className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.5} />
              <div>
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-sm font-medium text-slate-300">{s[key] ?? 0}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
