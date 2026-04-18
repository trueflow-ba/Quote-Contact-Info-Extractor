import { useState, useMemo, useEffect, useCallback } from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ArrowUpDown, Search, Download, Loader2, Settings2 } from 'lucide-react';
import api from '@/lib/api';
import { toast } from 'sonner';

const ALL_FIELDS = [
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'company', label: 'Company' },
  { key: 'quote_amount', label: 'Quote Amount' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'bid_by', label: 'Bid By' },
  { key: 'source_filename', label: 'Source File' },
  { key: 'import_date', label: 'Import Date' },
];

const TABLE_COLUMNS = ALL_FIELDS;

export default function AllContactsTable() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [showExport, setShowExport] = useState(false);
  const [exportFields, setExportFields] = useState(
    ALL_FIELDS.map(f => f.key)
  );

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/contacts/all');
      setContacts(data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const filtered = useMemo(() => {
    let data = contacts;
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(c => Object.values(c).some(v => typeof v === 'string' && v.toLowerCase().includes(q)));
    }
    if (sortKey) {
      data = [...data].sort((a, b) => {
        const av = (a[sortKey] || '').toLowerCase();
        const bv = (b[sortKey] || '').toLowerCase();
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return data;
  }, [contacts, search, sortKey, sortDir]);

  const toggleField = (key) => {
    setExportFields(prev =>
      prev.includes(key) ? prev.filter(f => f !== key) : [...prev, key]
    );
  };

  const downloadCustomCSV = async () => {
    if (exportFields.length === 0) { toast.error('Select at least one field'); return; }
    try {
      const resp = await api.post('/contacts/download', { fields: exportFields }, { responseType: 'blob' });
      const blob = new Blob([resp.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'contacts_all.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('CSV downloaded');
      setShowExport(false);
    } catch {
      toast.error('Failed to download CSV');
    }
  };

  const formatDate = (iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="all-contacts-loading">
        <Loader2 className="h-5 w-5 text-sky-500 animate-spin" />
      </div>
    );
  }

  if (!contacts.length) {
    return (
      <div className="text-center py-16 text-slate-500 text-sm" data-testid="all-contacts-empty">
        No contacts across any runs yet. Upload PDFs and extract contacts to build your master list.
      </div>
    );
  }

  return (
    <div data-testid="all-contacts-table-container">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            data-testid="all-contacts-search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search all contacts..."
            className="pl-9 bg-[#111827] border-slate-800 text-slate-300 placeholder:text-slate-600 h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">{filtered.length} total contacts</span>
          <button
            onClick={() => setShowExport(true)}
            className="bg-sky-500 hover:bg-sky-600 text-white rounded-sm px-4 py-1.5 text-sm font-medium transition-colors inline-flex items-center gap-2"
            data-testid="export-csv-button"
          >
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </div>

      <div className="border border-slate-800 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-transparent">
                {TABLE_COLUMNS.map(col => (
                  <TableHead
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="bg-[#111827] text-slate-400 font-medium text-xs uppercase tracking-wider py-3 px-3 cursor-pointer hover:text-slate-200 transition-colors whitespace-nowrap"
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      <ArrowUpDown className={`h-3 w-3 ${sortKey === col.key ? 'text-sky-400' : 'text-slate-600'}`} />
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c, i) => (
                <TableRow key={c.id || i} className="border-slate-800 hover:bg-slate-800/30 text-sm text-slate-300">
                  {TABLE_COLUMNS.map(col => (
                    <TableCell key={col.key} className="py-2 px-3 whitespace-nowrap">
                      {col.key === 'email' || col.key === 'phone' ? (
                        <span className="font-mono text-xs">{c[col.key] || <span className="text-slate-600">-</span>}</span>
                      ) : col.key === 'import_date' ? (
                        <span className="text-xs text-slate-400">{formatDate(c[col.key])}</span>
                      ) : col.key === 'quote_amount' ? (
                        c[col.key] ? <span className="font-mono text-xs text-emerald-400">{c[col.key]}</span> : <span className="text-slate-600">-</span>
                      ) : (
                        c[col.key] || <span className="text-slate-600">-</span>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Export field selector dialog */}
      <Dialog open={showExport} onOpenChange={setShowExport}>
        <DialogContent className="bg-[#111827] border-slate-800 text-slate-200 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-slate-100 flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-sky-400" /> Select CSV Fields
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1 py-2 max-h-72 overflow-y-auto">
            {ALL_FIELDS.map(f => (
              <label key={f.key} className="flex items-center gap-3 px-2 py-1.5 rounded-sm hover:bg-slate-800/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportFields.includes(f.key)}
                  onChange={() => toggleField(f.key)}
                  className="rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-sky-500"
                  data-testid={`field-checkbox-${f.key}`}
                />
                <span className="text-sm text-slate-300">{f.label}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
            <button
              onClick={() => setExportFields(exportFields.length === ALL_FIELDS.length ? [] : ALL_FIELDS.map(f => f.key))}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              data-testid="toggle-all-fields"
            >
              {exportFields.length === ALL_FIELDS.length ? 'Deselect All' : 'Select All'}
            </button>
            <span className="text-xs text-slate-500">{exportFields.length} fields selected</span>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <button onClick={() => setShowExport(false)} className="bg-transparent border border-slate-700 text-slate-300 hover:bg-slate-800 rounded-sm px-4 py-2 text-sm transition-colors">Cancel</button>
            <button
              onClick={downloadCustomCSV}
              disabled={exportFields.length === 0}
              className="bg-sky-500 hover:bg-sky-600 text-white rounded-sm px-4 py-2 text-sm font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50"
              data-testid="confirm-export-csv"
            >
              <Download className="h-3.5 w-3.5" /> Download
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
