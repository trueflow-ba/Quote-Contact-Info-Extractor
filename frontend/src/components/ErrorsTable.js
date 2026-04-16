import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { AlertTriangle, Download } from 'lucide-react';
import api from '@/lib/api';
import { toast } from 'sonner';

export default function ErrorsTable({ errors, runId }) {
  const downloadErrors = async () => {
    if (!runId) return;
    try {
      const resp = await api.get(`/runs/${runId}/download/errors`, { responseType: 'blob' });
      const blob = new Blob([resp.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `error_report_${runId.slice(0, 8)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Error report downloaded');
    } catch {
      toast.error('Failed to download error report');
    }
  };

  if (!errors?.length) {
    return (
      <div className="text-center py-16 text-slate-500 text-sm" data-testid="errors-empty">
        No processing issues found. All PDFs processed successfully.
      </div>
    );
  }

  return (
    <div data-testid="errors-table-container">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-amber-400">
          <AlertTriangle className="h-4 w-4" strokeWidth={1.5} />
          <span className="text-sm font-medium">{errors.length} issues found</span>
        </div>
        <button
          onClick={downloadErrors}
          className="bg-transparent border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white rounded-sm px-4 py-1.5 text-sm transition-colors inline-flex items-center gap-2"
          data-testid="download-error-csv-button"
        >
          <Download className="h-3.5 w-3.5" /> Download Error Report
        </button>
      </div>

      <div className="border border-slate-800 rounded-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-transparent">
              <TableHead className="bg-[#111827] text-slate-400 font-medium text-xs uppercase tracking-wider py-3 px-3">Filename</TableHead>
              <TableHead className="bg-[#111827] text-slate-400 font-medium text-xs uppercase tracking-wider py-3 px-3">Reason</TableHead>
              <TableHead className="bg-[#111827] text-slate-400 font-medium text-xs uppercase tracking-wider py-3 px-3">Missing Fields</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {errors.map((e, i) => (
              <TableRow key={e.id || i} className="border-slate-800 hover:bg-slate-800/30 text-sm text-slate-300">
                <TableCell className="py-2 px-3 font-mono text-xs text-sky-400 whitespace-nowrap">{e.filename}</TableCell>
                <TableCell className="py-2 px-3 text-slate-400">{e.reason}</TableCell>
                <TableCell className="py-2 px-3 text-amber-400/80 text-xs">{e.missing_fields || '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
