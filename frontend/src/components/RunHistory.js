import { useState } from 'react';
import { Calendar, Download, FileText, CheckCircle, AlertTriangle, Trash2, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import api from '@/lib/api';
import { toast } from 'sonner';

export default function RunHistory({ runs, onSelectRun, onDeleteRun, onRetryRun, currentRunId }) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(null);

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

  const downloadLogXLSX = async (e, runId) => {
    e.stopPropagation();
    try {
      const resp = await api.get(`/runs/${runId}/download/log`, { responseType: 'blob' });
      const blob = new Blob([resp.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `processing_log_${runId.slice(0, 8)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Processing log downloaded');
    } catch {
      toast.error('Log download failed');
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/runs/${confirmDelete}`);
      toast.success('Run deleted');
      if (onDeleteRun) onDeleteRun(confirmDelete);
    } catch {
      toast.error('Failed to delete run');
    }
    setDeleting(false);
    setConfirmDelete(null);
  };

  const handleRetry = async (e, runId) => {
    e.stopPropagation();
    setRetrying(runId);
    try {
      await api.post(`/extract/${runId}`);
      toast.success('Extraction restarted');
      if (onRetryRun) onRetryRun(runId);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to retry');
    }
    setRetrying(null);
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
    <>
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
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    run.status === 'completed' ? 'bg-emerald-400' :
                    run.status === 'processing' ? 'bg-amber-400 animate-pulse' :
                    run.status === 'uploading' ? 'bg-sky-400 animate-pulse' :
                    run.status === 'paused' ? 'bg-sky-400' :
                    run.status === 'cancelled' ? 'bg-slate-400' :
                    run.status === 'stale' ? 'bg-orange-400' :
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

                <div className="flex items-center gap-2">
                  {/* Processing Log is always available (live status, even mid-run) */}
                  {run.status !== 'uploading' && (
                    <button
                      onClick={(e) => downloadLogXLSX(e, run.id)}
                      className="text-xs bg-transparent border border-sky-500/20 text-sky-400 hover:bg-sky-500/10 rounded-sm px-3 py-1 transition-colors inline-flex items-center gap-1"
                      data-testid={`download-log-${run.id}`}
                      title="Download Excel processing log (live status)"
                    >
                      <Download className="h-3 w-3" /> Log
                    </button>
                  )}
                  {run.status === 'completed' && (
                    <>
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
                    </>
                  )}
                  {(run.status === 'uploaded') && (
                    <button
                      onClick={(e) => handleRetry(e, run.id)}
                      disabled={retrying === run.id}
                      className="text-xs bg-sky-500/10 border border-sky-500/20 text-sky-400 hover:bg-sky-500 hover:text-white rounded-sm px-3 py-1 transition-colors inline-flex items-center gap-1 disabled:opacity-50"
                      data-testid={`extract-run-${run.id}`}
                    >
                      <RotateCcw className={`h-3 w-3 ${retrying === run.id ? 'animate-spin' : ''}`} />
                      Extract
                    </button>
                  )}
                  {(run.status === 'stale' || run.status === 'failed' || run.status === 'paused') && (
                    <button
                      onClick={(e) => handleRetry(e, run.id)}
                      disabled={retrying === run.id}
                      className="text-xs bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500 hover:text-white rounded-sm px-3 py-1 transition-colors inline-flex items-center gap-1 disabled:opacity-50"
                      data-testid={`retry-run-${run.id}`}
                    >
                      <RotateCcw className={`h-3 w-3 ${retrying === run.id ? 'animate-spin' : ''}`} />
                      {run.status === 'paused' ? 'Resume' : 'Retry'}
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(run.id); }}
                    className="text-xs bg-transparent border border-slate-800 text-slate-600 hover:text-red-400 hover:border-red-500/30 rounded-sm px-2 py-1 transition-colors"
                    data-testid={`delete-run-${run.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Confirm Delete Dialog */}
      <Dialog open={!!confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent className="bg-[#111827] border-slate-800 text-slate-200 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-slate-100">Delete Run</DialogTitle>
            <DialogDescription className="text-slate-400">
              This will permanently delete this extraction run, including all contacts, duplicates, error reports, and uploaded file references. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <button
              onClick={() => setConfirmDelete(null)}
              className="bg-transparent border border-slate-700 text-slate-300 hover:bg-slate-800 rounded-sm px-4 py-2 text-sm transition-colors"
              data-testid="cancel-delete-run"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-500 hover:bg-red-600 text-white rounded-sm px-4 py-2 text-sm font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50"
              data-testid="confirm-delete-run"
            >
              {deleting ? 'Deleting...' : 'Delete Run'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
