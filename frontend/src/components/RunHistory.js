import { Calendar, Download, FileText, CheckCircle, AlertTriangle } from 'lucide-react';
import api from '@/lib/api';
import { toast } from 'sonner';

export default function RunHistory({ runs, onSelectRun, currentRunId }) {
  const downloadCSV = async (e, runId, type) => {
    e.stopPropagation();
    try {
      const resp = await api.get(`/runs/${runId}/download/${type}`, { responseType: 'blob' });
      const blob = new Blob([resp.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}_${runId.slice(0, 8)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`${type === 'contacts' ? 'Contacts CSV' : 'Error report'} downloaded`);
    } catch {
      toast.error('Download failed');
    }
  };

  const formatDate = (iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  if (!runs?.length) {
    return (
      <div className="text-center py-16 text-slate-500 text-sm" data-testid="history-empty">
        No previous runs. Upload PDFs and extract contacts to see history.
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="run-history-list">
      {runs.map(run => {
        const s = run.stats || {};
        const isActive = run.id === currentRunId;
        return (
          <div
            key={run.id}
            onClick={() => onSelectRun(run.id)}
            className={`bg-[#111827] border rounded-sm p-4 cursor-pointer transition-all ${
              isActive ? 'border-sky-500/50 bg-sky-500/5' : 'border-slate-800 hover:border-slate-700'
            }`}
            data-testid={`run-item-${run.id}`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${
                  run.status === 'completed' ? 'bg-emerald-400' :
                  run.status === 'processing' ? 'bg-amber-400 animate-pulse' :
                  run.status === 'failed' ? 'bg-red-400' : 'bg-slate-500'
                }`} />
                <div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.5} />
                    <span className="text-sm text-slate-300">{formatDate(run.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" /> {s.total_pdfs || 0} PDFs</span>
                    <span className="inline-flex items-center gap-1"><CheckCircle className="h-3 w-3 text-emerald-500" /> {s.processed || 0}</span>
                    {s.errors > 0 && <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-red-400" /> {s.errors}</span>}
                    <span className="text-sky-400">{s.net_new || 0} contacts</span>
                  </div>
                </div>
              </div>

              {run.status === 'completed' && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => downloadCSV(e, run.id, 'contacts')}
                    className="text-xs bg-transparent border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 rounded-sm px-3 py-1 transition-colors inline-flex items-center gap-1"
                    data-testid={`download-contacts-${run.id}`}
                  >
                    <Download className="h-3 w-3" /> Contacts
                  </button>
                  {s.errors > 0 && (
                    <button
                      onClick={(e) => downloadCSV(e, run.id, 'errors')}
                      className="text-xs bg-transparent border border-red-500/20 text-red-400 hover:bg-red-500/10 rounded-sm px-3 py-1 transition-colors inline-flex items-center gap-1"
                      data-testid={`download-errors-${run.id}`}
                    >
                      <Download className="h-3 w-3" /> Errors
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
