import { useState, useMemo } from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { ArrowUpDown, Search, Download, Layers, List } from 'lucide-react';
import ColumnFilter, { applyColumnFilters } from '@/components/ColumnFilter';
import api from '@/lib/api';
import { toast } from 'sonner';

const flatColumns = [
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'company', label: 'Company' },
  { key: 'quote_amount', label: 'Quote Amount' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'bid_by', label: 'Bid By' },
  { key: 'source_filename', label: 'Source' },
];

const groupedColumns = [
  { key: 'company', label: 'Company' },
  { key: 'bid_by', label: 'Bid By' },
  { key: 'count', label: 'Count' },
  { key: 'quote_amount', label: 'Quote Amount' },
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
];

export default function ContactsTable({ contacts, runId }) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [grouped, setGrouped] = useState(false);
  const [filters, setFilters] = useState({});

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const filtered = useMemo(() => {
    let data = contacts || [];
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(c => Object.values(c).some(v => typeof v === 'string' && v.toLowerCase().includes(q)));
    }
    data = applyColumnFilters(data, filters);
    if (sortKey && sortKey !== 'count') {
      data = [...data].sort((a, b) => {
        const av = (a[sortKey] || '').toLowerCase();
        const bv = (b[sortKey] || '').toLowerCase();
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return data;
  }, [contacts, search, sortKey, sortDir, filters]);

  const groupedData = useMemo(() => {
    if (!grouped) return null;
    const groups = {};
    for (const c of filtered) {
      const key = `${(c.company || '').trim().toLowerCase()}|||${(c.bid_by || '').trim().toLowerCase()}`;
      if (!groups[key]) groups[key] = { ...c, count: 1 };
      else groups[key].count += 1;
    }
    let rows = Object.values(groups);
    if (sortKey === 'count') rows.sort((a, b) => sortDir === 'asc' ? a.count - b.count : b.count - a.count);
    else if (sortKey) rows.sort((a, b) => { const av = (a[sortKey] || '').toLowerCase(); const bv = (b[sortKey] || '').toLowerCase(); return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av); });
    else rows.sort((a, b) => b.count - a.count);
    return rows;
  }, [filtered, grouped, sortKey, sortDir]);

  const displayData = grouped ? groupedData : filtered;
  const activeColumns = grouped ? groupedColumns : flatColumns;
  const activeFilterCount = Object.keys(filters).length;

  const downloadCSV = async () => {
    if (!runId) return;
    try {
      const resp = await api.get(`/runs/${runId}/download/contacts`, { responseType: 'blob' });
      const blob = new Blob([resp.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `contacts_${runId.slice(0, 8)}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('CSV downloaded');
    } catch { toast.error('Failed to download CSV'); }
  };

  const downloadGroupedCSV = () => {
    if (!groupedData?.length) return;
    const headers = ['Company', 'Bid By', 'Count', 'Quote Amount', 'First Name', 'Last Name', 'Email', 'Phone', 'City', 'State'];
    const esc = (v) => { const s = String(v ?? ''); return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = groupedData.map(c => [c.company, c.bid_by, c.count, c.quote_amount, c.first_name, c.last_name, c.email, c.phone, c.city, c.state].map(esc).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `contacts_grouped_${runId ? runId.slice(0, 8) : 'export'}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success('Grouped CSV downloaded');
  };

  if (!contacts?.length) {
    return <div className="text-center py-16 text-slate-500 text-sm" data-testid="contacts-empty">No contacts extracted yet. Upload PDFs and run extraction.</div>;
  }

  return (
    <div data-testid="contacts-table-container">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input data-testid="contacts-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter contacts..."
              className="pl-9 bg-[#111827] border-slate-800 text-slate-300 placeholder:text-slate-600 h-8 text-sm" />
          </div>
          <button onClick={() => { setGrouped(g => !g); setSortKey(''); }}
            className={`rounded-sm px-3 py-1.5 text-sm font-medium transition-all inline-flex items-center gap-2 border whitespace-nowrap ${grouped ? 'bg-purple-500/15 border-purple-500/30 text-purple-300' : 'bg-transparent border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
            data-testid="group-by-company-button">
            {grouped ? <List className="h-3.5 w-3.5" /> : <Layers className="h-3.5 w-3.5" />}
            {grouped ? 'Show All' : 'Group by Company + Bid'}
          </button>
          {activeFilterCount > 0 && (
            <button onClick={() => setFilters({})} className="text-xs text-amber-400 hover:text-amber-300 transition-colors whitespace-nowrap" data-testid="clear-all-filters">
              Clear {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {grouped ? `${displayData?.length || 0} groups from ${filtered.length}` : `${filtered.length} contacts`}
          </span>
          {grouped && (
            <button onClick={downloadGroupedCSV}
              className="bg-purple-500/15 border border-purple-500/30 text-purple-300 hover:bg-purple-500 hover:text-white rounded-sm px-4 py-1.5 text-sm font-medium transition-colors inline-flex items-center gap-2"
              data-testid="download-grouped-csv-button">
              <Download className="h-3.5 w-3.5" /> Grouped CSV
            </button>
          )}
          <button onClick={downloadCSV}
            className="bg-sky-500 hover:bg-sky-600 text-white rounded-sm px-4 py-1.5 text-sm font-medium transition-colors inline-flex items-center gap-2"
            data-testid="download-csv-button">
            <Download className="h-3.5 w-3.5" /> {grouped ? 'Full CSV' : 'Download CSV'}
          </button>
        </div>
      </div>

      <div className="border border-slate-800 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-transparent">
                {activeColumns.map(col => (
                  <TableHead key={col.key}
                    className="bg-[#111827] text-slate-400 font-medium text-xs uppercase tracking-wider py-3 px-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <span className="cursor-pointer hover:text-slate-200 transition-colors" onClick={() => handleSort(col.key)}>
                        {col.label}
                        <ArrowUpDown className={`inline h-3 w-3 ml-0.5 ${sortKey === col.key ? 'text-sky-400' : 'text-slate-600'}`} />
                      </span>
                      {col.key !== 'count' && <ColumnFilter columnKey={col.key} data={contacts} filters={filters} setFilters={setFilters} />}
                    </span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayData?.map((c, i) => (
                <TableRow key={c.id || i} className="border-slate-800 hover:bg-slate-800/30 text-sm text-slate-300">
                  {activeColumns.map(col => (
                    <TableCell key={col.key} className="py-2 px-3 whitespace-nowrap">
                      {col.key === 'count' ? (
                        <span className={`inline-flex items-center justify-center min-w-[28px] rounded-sm px-2 py-0.5 text-xs font-semibold ${c.count > 1 ? 'bg-purple-500/15 text-purple-300 border border-purple-500/20' : 'text-slate-500'}`}>{c.count}</span>
                      ) : col.key === 'quote_amount' ? (
                        c[col.key] ? <span className="font-mono text-xs text-emerald-400">{c[col.key]}</span> : <span className="text-slate-600">-</span>
                      ) : col.key === 'email' || col.key === 'phone' ? (
                        <span className="font-mono text-xs">{c[col.key] || <span className="text-slate-600">-</span>}</span>
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
    </div>
  );
}
