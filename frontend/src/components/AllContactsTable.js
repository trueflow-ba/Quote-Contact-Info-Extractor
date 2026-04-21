import { useState, useMemo, useEffect, useCallback } from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ArrowUpDown, Search, Download, Loader2, Settings2, Layers, List, GripVertical, RotateCcw } from 'lucide-react';
import ColumnFilter, { applyColumnFilters } from '@/components/ColumnFilter';
import { useColumnOrder } from '@/hooks/useColumnOrder';
import api from '@/lib/api';
import { toast } from 'sonner';

const ALL_FIELDS = [
  { key: 'csi', label: 'CSI' },
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'contractor', label: 'Contractor' },
  { key: 'sub_contractor', label: 'Sub-Contractor' },
  { key: 'quote_amount', label: 'Quote Amount' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'bid_by', label: 'Bid By' },
  { key: 'customer_contact_name', label: 'Customer Contact' },
  { key: 'customer_business', label: 'Customer Business' },
  { key: 'customer_address', label: 'Customer Address' },
  { key: 'source_filename', label: 'Source File' },
  { key: 'import_date', label: 'Import Date' },
];

const GROUPED_COLUMNS = [
  { key: 'csi', label: 'CSI' },
  { key: 'sub_contractor', label: 'Sub-Contractor' },
  { key: 'bid_by', label: 'Bid By' },
  { key: 'count', label: 'Count' },
  { key: 'contractor', label: 'Contractor' },
  { key: 'quote_amount', label: 'Quote Amount' },
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'customer_contact_name', label: 'Customer Contact' },
  { key: 'customer_business', label: 'Customer Business' },
  { key: 'customer_address', label: 'Customer Address' },
  { key: 'import_date', label: 'Import Date' },
];

export default function AllContactsTable() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [grouped, setGrouped] = useState(false);
  const [filters, setFilters] = useState({});
  const [showExport, setShowExport] = useState(false);

  const flatOrder = useColumnOrder(ALL_FIELDS, 'all-contacts-flat-cols');
  const groupedOrder = useColumnOrder(GROUPED_COLUMNS, 'all-contacts-grouped-cols');
  const active = grouped ? groupedOrder : flatOrder;
  const activeColumns = active.columns;

  // Export-field selection: defaults to all fields in CURRENT UI order
  const [exportFields, setExportFields] = useState(ALL_FIELDS.map(f => f.key));

  // Whenever column order changes, keep the export selection in sync with UI order
  // (preserves user's include/exclude choices)
  useEffect(() => {
    setExportFields(prev => {
      const inOrder = flatOrder.columns.map(c => c.key).filter(k => prev.includes(k));
      // Any fields in prev that aren't in current columns (shouldn't happen but safe)
      const extras = prev.filter(k => !flatOrder.columns.find(c => c.key === k));
      return [...inOrder, ...extras];
    });
  }, [flatOrder.columns]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get('/contacts/all'); setContacts(data); } catch {}
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
    data = applyColumnFilters(data, filters);
    if (sortKey && sortKey !== 'count') {
      data = [...data].sort((a, b) => {
        const av = (a[sortKey] || '').toString().toLowerCase();
        const bv = (b[sortKey] || '').toString().toLowerCase();
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return data;
  }, [contacts, search, sortKey, sortDir, filters]);

  const groupedData = useMemo(() => {
    if (!grouped) return null;
    const groups = {};
    for (const c of filtered) {
      const key = `${(c.sub_contractor || '').trim().toLowerCase()}|||${(c.bid_by || '').trim().toLowerCase()}`;
      if (!groups[key]) groups[key] = { ...c, count: 1 };
      else groups[key].count += 1;
    }
    let rows = Object.values(groups);
    if (sortKey === 'count') rows.sort((a, b) => sortDir === 'asc' ? a.count - b.count : b.count - a.count);
    else if (sortKey) rows.sort((a, b) => { const av = (a[sortKey] || '').toString().toLowerCase(); const bv = (b[sortKey] || '').toString().toLowerCase(); return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av); });
    else rows.sort((a, b) => b.count - a.count);
    return rows;
  }, [filtered, grouped, sortKey, sortDir]);

  const displayData = grouped ? groupedData : filtered;
  const activeFilterCount = Object.keys(filters).length;

  const toggleField = (key) => setExportFields(prev => prev.includes(key) ? prev.filter(f => f !== key) : [...prev, key]);

  const downloadCustomCSV = async () => {
    if (exportFields.length === 0) { toast.error('Select at least one field'); return; }
    try {
      // Reorder export fields to match current UI column order
      const uiOrderedFields = flatOrder.columns.map(c => c.key).filter(k => exportFields.includes(k));
      const finalFields = uiOrderedFields.length ? uiOrderedFields : exportFields;
      const resp = await api.post('/contacts/download', { fields: finalFields }, { responseType: 'blob' });
      const blob = new Blob([resp.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'contacts_all.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('CSV downloaded'); setShowExport(false);
    } catch { toast.error('Failed to download CSV'); }
  };

  const downloadGroupedCSV = () => {
    if (!groupedData?.length) return;
    const cols = activeColumns;
    const esc = (v) => { const s = String(v ?? ''); return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s; };
    const fmtDate = (iso) => { if (!iso) return ''; try { return new Date(iso).toLocaleDateString('en-US'); } catch { return iso; } };
    const headers = cols.map(c => c.label).map(esc).join(',');
    const rows = groupedData.map(c => cols.map(col => col.key === 'import_date' ? fmtDate(c[col.key]) : (c[col.key] ?? '')).map(esc).join(','));
    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'contacts_all_grouped.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success('Grouped CSV downloaded');
  };

  const formatDate = (iso) => {
    if (!iso) return '-';
    try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return iso; }
  };

  if (loading) return <div className="flex items-center justify-center py-16" data-testid="all-contacts-loading"><Loader2 className="h-5 w-5 text-sky-500 animate-spin" /></div>;

  if (!contacts.length) return <div className="text-center py-16 text-slate-500 text-sm" data-testid="all-contacts-empty">No contacts across any runs yet. Upload PDFs and extract contacts to build your master list.</div>;

  return (
    <div data-testid="all-contacts-table-container">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input data-testid="all-contacts-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search all contacts..."
              className="pl-9 bg-[#111827] border-slate-800 text-slate-300 placeholder:text-slate-600 h-8 text-sm" />
          </div>
          <button onClick={() => { setGrouped(g => !g); setSortKey(''); }}
            className={`rounded-sm px-3 py-1.5 text-sm font-medium transition-all inline-flex items-center gap-2 border whitespace-nowrap ${grouped ? 'bg-purple-500/15 border-purple-500/30 text-purple-300' : 'bg-transparent border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
            data-testid="all-group-by-company-button">
            {grouped ? <List className="h-3.5 w-3.5" /> : <Layers className="h-3.5 w-3.5" />}
            {grouped ? 'Show All' : 'Group by Sub + Bid'}
          </button>
          {activeFilterCount > 0 && (
            <button onClick={() => setFilters({})} className="text-xs text-amber-400 hover:text-amber-300 transition-colors whitespace-nowrap" data-testid="clear-all-filters-all">
              Clear {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
            </button>
          )}
          <button onClick={active.resetOrder} title="Reset column order"
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors inline-flex items-center gap-1 whitespace-nowrap"
            data-testid="all-reset-column-order">
            <RotateCcw className="h-3 w-3" /> Reset cols
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {grouped ? `${displayData?.length || 0} groups from ${filtered.length}` : `${filtered.length} total contacts`}
          </span>
          {grouped && (
            <button onClick={downloadGroupedCSV}
              className="bg-purple-500/15 border border-purple-500/30 text-purple-300 hover:bg-purple-500 hover:text-white rounded-sm px-4 py-1.5 text-sm font-medium transition-colors inline-flex items-center gap-2"
              data-testid="all-download-grouped-csv">
              <Download className="h-3.5 w-3.5" /> Grouped CSV
            </button>
          )}
          <button onClick={() => setShowExport(true)}
            className="bg-sky-500 hover:bg-sky-600 text-white rounded-sm px-4 py-1.5 text-sm font-medium transition-colors inline-flex items-center gap-2"
            data-testid="export-csv-button">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </div>

      <div className="border border-slate-800 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-transparent">
                {activeColumns.map((col, idx) => {
                  const dragProps = active.getDragProps(col, idx);
                  const isDragOver = active.dragOverKey === col.key;
                  return (
                    <TableHead key={col.key} {...dragProps}
                      className={`bg-[#111827] text-slate-400 font-medium text-xs uppercase tracking-wider py-3 px-3 whitespace-nowrap transition-colors ${isDragOver ? 'bg-sky-500/10 border-l-2 border-sky-400' : ''}`}
                      data-testid={`all-col-header-${col.key}`}>
                      <span className="inline-flex items-center gap-1">
                        <GripVertical className="h-3 w-3 text-slate-700 cursor-grab active:cursor-grabbing" />
                        <span className="cursor-pointer hover:text-slate-200 transition-colors" onClick={() => handleSort(col.key)}>
                          {col.label}
                          <ArrowUpDown className={`inline h-3 w-3 ml-0.5 ${sortKey === col.key ? 'text-sky-400' : 'text-slate-600'}`} />
                        </span>
                        {col.key !== 'count' && <ColumnFilter columnKey={col.key} data={contacts} filters={filters} setFilters={setFilters} />}
                      </span>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayData?.map((c, i) => (
                <TableRow key={c.id || i} className="border-slate-800 hover:bg-slate-800/30 text-sm text-slate-300">
                  {activeColumns.map(col => (
                    <TableCell key={col.key} className="py-2 px-3 whitespace-nowrap">
                      {col.key === 'count' ? (
                        <span className={`inline-flex items-center justify-center min-w-[28px] rounded-sm px-2 py-0.5 text-xs font-semibold ${c.count > 1 ? 'bg-purple-500/15 text-purple-300 border border-purple-500/20' : 'text-slate-500'}`}>{c.count}</span>
                      ) : col.key === 'csi' ? (
                        c[col.key] ? <span className="font-mono text-xs text-sky-300">{c[col.key]}</span> : <span className="text-slate-600">-</span>
                      ) : col.key === 'quote_amount' ? (
                        c[col.key] ? <span className="font-mono text-xs text-emerald-400">{c[col.key]}</span> : <span className="text-slate-600">-</span>
                      ) : col.key === 'email' || col.key === 'phone' ? (
                        <span className="font-mono text-xs">{c[col.key] || <span className="text-slate-600">-</span>}</span>
                      ) : col.key === 'import_date' ? (
                        <span className="text-xs text-slate-400">{formatDate(c[col.key])}</span>
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

      {/* Export field selector dialog — displays fields in current UI column order */}
      <Dialog open={showExport} onOpenChange={setShowExport}>
        <DialogContent className="bg-[#111827] border-slate-800 text-slate-200 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-slate-100 flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-sky-400" /> Select CSV Fields
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-500 -mt-1">Export order matches table column order. Drag headers to reorder.</p>
          <div className="space-y-1 py-2 max-h-72 overflow-y-auto">
            {flatOrder.columns.map(f => (
              <label key={f.key} className="flex items-center gap-3 px-2 py-1.5 rounded-sm hover:bg-slate-800/50 cursor-pointer">
                <input type="checkbox" checked={exportFields.includes(f.key)} onChange={() => toggleField(f.key)}
                  className="rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-sky-500" data-testid={`field-checkbox-${f.key}`} />
                <span className="text-sm text-slate-300">{f.label}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-slate-800">
            <button onClick={() => setExportFields(exportFields.length === flatOrder.columns.length ? [] : flatOrder.columns.map(f => f.key))}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors" data-testid="toggle-all-fields">
              {exportFields.length === flatOrder.columns.length ? 'Deselect All' : 'Select All'}
            </button>
            <span className="text-xs text-slate-500">{exportFields.length} fields selected</span>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <button onClick={() => setShowExport(false)} className="bg-transparent border border-slate-700 text-slate-300 hover:bg-slate-800 rounded-sm px-4 py-2 text-sm transition-colors">Cancel</button>
            <button onClick={downloadCustomCSV} disabled={exportFields.length === 0}
              className="bg-sky-500 hover:bg-sky-600 text-white rounded-sm px-4 py-2 text-sm font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50" data-testid="confirm-export-csv">
              <Download className="h-3.5 w-3.5" /> Download
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
