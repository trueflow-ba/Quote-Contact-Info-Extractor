import { useState, useMemo } from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { ArrowUpDown, Search, Download } from 'lucide-react';
import api from '@/lib/api';
import { toast } from 'sonner';

const columns = [
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'company', label: 'Company' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'bid_by', label: 'Bid By' },
  { key: 'source_filename', label: 'Source' },
];

export default function ContactsTable({ contacts, runId }) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState('asc');

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const filtered = useMemo(() => {
    let data = contacts || [];
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(c =>
        Object.values(c).some(v => typeof v === 'string' && v.toLowerCase().includes(q))
      );
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

  const downloadCSV = async () => {
    if (!runId) return;
    try {
      const resp = await api.get(`/runs/${runId}/download/contacts`, { responseType: 'blob' });
      const blob = new Blob([resp.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `contacts_${runId.slice(0, 8)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('CSV downloaded');
    } catch {
      toast.error('Failed to download CSV');
    }
  };

  if (!contacts?.length) {
    return (
      <div className="text-center py-16 text-slate-500 text-sm" data-testid="contacts-empty">
        No contacts extracted yet. Upload PDFs and run extraction.
      </div>
    );
  }

  return (
    <div data-testid="contacts-table-container">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <Input
            data-testid="contacts-search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter contacts..."
            className="pl-9 bg-[#111827] border-slate-800 text-slate-300 placeholder:text-slate-600 h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">{filtered.length} contacts</span>
          <button
            onClick={downloadCSV}
            className="bg-sky-500 hover:bg-sky-600 text-white rounded-sm px-4 py-1.5 text-sm font-medium transition-colors inline-flex items-center gap-2"
            data-testid="download-csv-button"
          >
            <Download className="h-3.5 w-3.5" /> Download CSV
          </button>
        </div>
      </div>

      <div className="border border-slate-800 rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-transparent">
                {columns.map(col => (
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
                  {columns.map(col => (
                    <TableCell key={col.key} className="py-2 px-3 whitespace-nowrap">
                      {col.key === 'email' ? (
                        <span className="font-mono text-xs">{c[col.key]}</span>
                      ) : col.key === 'phone' ? (
                        <span className="font-mono text-xs">{c[col.key]}</span>
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
