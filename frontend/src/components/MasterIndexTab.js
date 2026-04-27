import { useState, useCallback, useEffect, useMemo } from 'react';
import { Upload, FileText, Download, Trash2, Loader2, CheckCircle2, AlertTriangle, Clock, XCircle, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import api from '@/lib/api';
import { toast } from 'sonner';

const STATUS_META = {
  'Processed':               { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle2 },
  'Processed (no contacts)': { color: 'text-sky-400',     bg: 'bg-sky-500/10 border-sky-500/20',         icon: CheckCircle2 },
  'Error':                   { color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/20',         icon: XCircle },
  'Pending':                 { color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20',     icon: Clock },
  'Not Uploaded':            { color: 'text-slate-400',   bg: 'bg-slate-700/40 border-slate-700',        icon: AlertTriangle },
};

export default function MasterIndexTab() {
  const [loading, setLoading] = useState(true);
  const [master, setMaster] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/master-index');
      setMaster(data.master);
      setComparison(data.comparison);
    } catch {
      toast.error('Failed to load master index');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleUpload = async (file) => {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.csv') && !lower.endsWith('.xlsx')) {
      toast.error('Please upload a .csv or .xlsx file');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/master-index/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`Master index uploaded: ${data.total} files`);
      await fetchAll();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Upload failed');
    }
    setUploading(false);
  };

  const handleClear = async () => {
    if (!window.confirm('Clear the current master index? You can upload a new one after.')) return;
    try {
      await api.delete('/master-index');
      toast.success('Master index cleared');
      setMaster(null);
      setComparison(null);
    } catch {
      toast.error('Failed to clear master index');
    }
  };

  const handleDownload = async () => {
    try {
      const resp = await api.get('/master-index/download', { responseType: 'blob' });
      const blob = new Blob([resp.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `master_index_comparison_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Comparison CSV downloaded');
    } catch {
      toast.error('Failed to download CSV');
    }
  };

  const filtered = useMemo(() => {
    if (!comparison?.results) return [];
    let data = comparison.results;
    if (statusFilter !== 'all') data = data.filter(r => r.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(r => r.filename.toLowerCase().includes(q));
    }
    return data;
  }, [comparison, search, statusFilter]);

  if (loading) {
    return <div className="flex items-center justify-center py-16" data-testid="master-index-loading"><Loader2 className="h-5 w-5 text-sky-500 animate-spin" /></div>;
  }

  // --- Empty state: upload zone ---
  if (!master) {
    return (
      <div data-testid="master-index-empty">
        <UploadZone onFile={handleUpload} uploading={uploading} />
        <div className="mt-4 px-3 py-2.5 bg-[#111827]/60 border border-slate-800 rounded-sm text-xs text-slate-500">
          <p className="mb-1 text-slate-400 font-medium">Master Index Audit</p>
          <p>Upload a CSV or XLSX with a single column <span className="text-slate-300 font-mono">FileName</span>. The app compares each filename against your Skip Registry and run history to report what's been processed, what's uploaded but not yet processed, and what still needs to be uploaded. Matching is <span className="text-slate-300">case-sensitive, exact filename</span>.</p>
        </div>
      </div>
    );
  }

  const s = comparison?.summary || {};
  const formatDate = (iso) => { if (!iso) return '-'; try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return iso; } };
  const statusCards = [
    { key: 'Processed',               label: 'Processed',             count: s.processed || 0,              statKey: 'processed' },
    { key: 'Processed (no contacts)', label: 'Processed (0 contacts)', count: s.processed_no_contacts || 0, statKey: 'processed_no_contacts' },
    { key: 'Error',                   label: 'Error',                 count: s.errored || 0,                statKey: 'errored' },
    { key: 'Pending',                 label: 'Pending',               count: s.pending || 0,                statKey: 'pending' },
    { key: 'Not Uploaded',            label: 'Not Uploaded',          count: s.not_uploaded || 0,           statKey: 'not_uploaded' },
  ];

  return (
    <div data-testid="master-index-container">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 px-3 py-2 bg-[#111827]/60 border border-slate-800 rounded-sm">
        <div className="flex items-center gap-3 text-sm">
          <FileText className="h-4 w-4 text-sky-400" />
          <div>
            <span className="text-slate-500">Master Index:</span>{' '}
            <span className="text-slate-100 font-medium" data-testid="master-filename">{master.original_filename}</span>
            <span className="text-slate-600 ml-2 text-xs">· {master.total} files · uploaded {formatDate(master.uploaded_at)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleDownload}
            className="bg-sky-500 hover:bg-sky-600 text-white rounded-sm px-3 py-1.5 text-sm font-medium transition-colors inline-flex items-center gap-2"
            data-testid="download-comparison-csv">
            <Download className="h-3.5 w-3.5" /> Download CSV
          </button>
          <label className="bg-transparent border border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors inline-flex items-center gap-2 cursor-pointer" data-testid="replace-master-button">
            <Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading...' : 'Replace'}
            <input type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleUpload(f); }} disabled={uploading} />
          </label>
          <button onClick={handleClear}
            className="bg-transparent border border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white rounded-sm px-3 py-1.5 text-sm font-medium transition-colors inline-flex items-center gap-2"
            data-testid="clear-master-button">
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <div className="bg-[#111827] border border-slate-800 rounded-sm px-4 py-3" data-testid="summary-card-total">
          <p className="text-xs text-slate-500 uppercase tracking-wider">Total</p>
          <p className="text-2xl font-semibold text-slate-100 font-mono">{s.total || 0}</p>
        </div>
        {statusCards.map(({ key, label, count, statKey }) => {
          const meta = STATUS_META[key];
          const Icon = meta.icon;
          const active = statusFilter === key;
          return (
            <button key={key} onClick={() => setStatusFilter(active ? 'all' : key)}
              className={`text-left bg-[#111827] border rounded-sm px-4 py-3 transition-colors ${active ? 'border-sky-500/50' : 'border-slate-800 hover:border-slate-700'}`}
              data-testid={`summary-card-${statKey}`}>
              <div className="flex items-center gap-2">
                <Icon className={`h-3.5 w-3.5 ${meta.color}`} strokeWidth={1.5} />
                <p className="text-xs text-slate-500 uppercase tracking-wider">{label}</p>
              </div>
              <p className={`text-2xl font-semibold font-mono mt-1 ${meta.color}`}>{count}</p>
            </button>
          );
        })}
      </div>

      {/* By-type breakdown */}
      {s.by_type?.length > 0 && (
        <div className="mb-4 bg-[#111827]/60 border border-slate-800 rounded-sm overflow-hidden" data-testid="by-type-breakdown">
          <div className="px-3 py-2 border-b border-slate-800">
            <p className="text-xs text-slate-500 uppercase tracking-wider">Breakdown by File Type</p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-500 text-xs uppercase tracking-wider py-2 px-3">Extension</TableHead>
                  <TableHead className="text-slate-500 text-xs uppercase tracking-wider py-2 px-3">Total</TableHead>
                  <TableHead className="text-emerald-400 text-xs uppercase tracking-wider py-2 px-3">Processed</TableHead>
                  <TableHead className="text-sky-400 text-xs uppercase tracking-wider py-2 px-3">No Contacts</TableHead>
                  <TableHead className="text-red-400 text-xs uppercase tracking-wider py-2 px-3">Error</TableHead>
                  <TableHead className="text-amber-400 text-xs uppercase tracking-wider py-2 px-3">Pending</TableHead>
                  <TableHead className="text-slate-400 text-xs uppercase tracking-wider py-2 px-3">Not Uploaded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.by_type.map(t => (
                  <TableRow key={t.extension} className="border-slate-800 hover:bg-slate-800/30 text-sm" data-testid={`by-type-row-${t.extension}`}>
                    <TableCell className="py-2 px-3 font-mono text-xs text-slate-300">{t.extension}</TableCell>
                    <TableCell className="py-2 px-3 font-mono text-slate-200">{t.total}</TableCell>
                    <TableCell className="py-2 px-3 font-mono text-emerald-400">{t.processed}</TableCell>
                    <TableCell className="py-2 px-3 font-mono text-sky-400">{t.processed_no_contacts}</TableCell>
                    <TableCell className="py-2 px-3 font-mono text-red-400">{t.errored}</TableCell>
                    <TableCell className="py-2 px-3 font-mono text-amber-400">{t.pending}</TableCell>
                    <TableCell className="py-2 px-3 font-mono text-slate-400">{t.not_uploaded}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-3">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search filenames..."
            className="pl-9 bg-[#111827] border-slate-800 text-slate-300 placeholder:text-slate-600 h-8 text-sm"
            data-testid="master-index-search" />
        </div>
        {statusFilter !== 'all' && (
          <button onClick={() => setStatusFilter('all')} className="text-xs text-amber-400 hover:text-amber-300 transition-colors" data-testid="clear-status-filter">
            Clear status filter: {statusFilter}
          </button>
        )}
        <span className="text-xs text-slate-500 ml-auto">{filtered.length} of {comparison?.results?.length || 0} shown</span>
      </div>

      {/* Results table */}
      <div className="border border-slate-800 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead className="bg-[#111827] text-slate-400 font-medium text-xs uppercase tracking-wider py-3 px-3">File Name</TableHead>
                <TableHead className="bg-[#111827] text-slate-400 font-medium text-xs uppercase tracking-wider py-3 px-3">Ext</TableHead>
                <TableHead className="bg-[#111827] text-slate-400 font-medium text-xs uppercase tracking-wider py-3 px-3">Status</TableHead>
                <TableHead className="bg-[#111827] text-slate-400 font-medium text-xs uppercase tracking-wider py-3 px-3">Contacts</TableHead>
                <TableHead className="bg-[#111827] text-slate-400 font-medium text-xs uppercase tracking-wider py-3 px-3">Source Archive</TableHead>
                <TableHead className="bg-[#111827] text-slate-400 font-medium text-xs uppercase tracking-wider py-3 px-3">Run</TableHead>
                <TableHead className="bg-[#111827] text-slate-400 font-medium text-xs uppercase tracking-wider py-3 px-3">Last Uploaded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r, i) => {
                const meta = STATUS_META[r.status] || STATUS_META['Not Uploaded'];
                return (
                  <TableRow key={i} className="border-slate-800 hover:bg-slate-800/30 text-sm text-slate-300" data-testid={`master-index-row-${i}`}>
                    <TableCell className="py-2 px-3 font-mono text-xs text-slate-200 max-w-md truncate" title={r.filename}>{r.filename}</TableCell>
                    <TableCell className="py-2 px-3 font-mono text-xs text-slate-500">{r.extension}</TableCell>
                    <TableCell className="py-2 px-3">
                      <span className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-xs font-medium ${meta.bg} ${meta.color}`}>
                        {r.status}
                      </span>
                    </TableCell>
                    <TableCell className="py-2 px-3 font-mono text-xs text-slate-300">{r.contacts_count || <span className="text-slate-600">-</span>}</TableCell>
                    <TableCell className="py-2 px-3 font-mono text-xs text-slate-400 max-w-xs truncate" title={r.archive_filename || ''}>
                      {r.archive_filename || <span className="text-slate-700">direct upload</span>}
                    </TableCell>
                    <TableCell className="py-2 px-3 font-mono text-xs">
                      {r.run_id ? (
                        <span className="text-slate-400" title={r.run_id}>
                          <span className="text-slate-300">{r.run_id.slice(0,8)}</span>
                          {r.run_status && <span className="text-slate-600 ml-1">· {r.run_status}</span>}
                        </span>
                      ) : <span className="text-slate-700">-</span>}
                    </TableCell>
                    <TableCell className="py-2 px-3 text-xs text-slate-500">{formatDate(r.processed_at)}</TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow className="border-slate-800">
                  <TableCell colSpan={7} className="text-center text-slate-500 py-8 text-sm">No files match the current filters.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function UploadZone({ onFile, uploading }) {
  const [dragActive, setDragActive] = useState(false);
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };
  return (
    <label
      onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
      onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className={`flex flex-col items-center justify-center border-2 border-dashed rounded-sm py-14 px-6 cursor-pointer transition-colors ${dragActive ? 'border-sky-500 bg-sky-500/5' : 'border-slate-800 bg-[#0F172A]/40 hover:border-slate-700'}`}
      data-testid="master-index-upload-zone">
      {uploading ? (
        <><Loader2 className="h-6 w-6 text-sky-500 animate-spin mb-2" /><p className="text-sm text-slate-400">Uploading master index...</p></>
      ) : (
        <>
          <Upload className="h-6 w-6 text-slate-500 mb-2" strokeWidth={1.5} />
          <p className="text-sm text-slate-300">Drop a <span className="text-sky-400 font-medium">.csv</span> or <span className="text-sky-400 font-medium">.xlsx</span> master index here</p>
          <p className="text-xs text-slate-500 mt-1">or click to browse</p>
          <p className="text-xs text-slate-600 mt-3">Single column named <span className="font-mono text-slate-400">FileName</span> (case-sensitive exact match)</p>
          <input type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} data-testid="master-index-file-input" />
        </>
      )}
    </label>
  );
}
