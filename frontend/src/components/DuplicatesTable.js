import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Copy } from 'lucide-react';

export default function DuplicatesTable({ duplicates }) {
  if (!duplicates?.length) {
    return (
      <div className="text-center py-16 text-slate-500 text-sm" data-testid="duplicates-empty">
        No duplicate contacts found in this run.
      </div>
    );
  }

  // Group by email
  const grouped = {};
  for (const d of duplicates) {
    const key = d.email;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(d);
  }

  return (
    <div data-testid="duplicates-table-container">
      <div className="flex items-center gap-2 mb-4 text-slate-400">
        <Copy className="h-4 w-4 text-purple-400" strokeWidth={1.5} />
        <span className="text-sm font-medium">{duplicates.length} duplicate entries across {Object.keys(grouped).length} emails</span>
      </div>

      <div className="space-y-4">
        {Object.entries(grouped).map(([email, dupes]) => (
          <div key={email} className="bg-[#111827] border border-slate-800 rounded-sm overflow-hidden">
            {/* Email header */}
            <div className="bg-slate-800/40 px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Copy className="h-3.5 w-3.5 text-purple-400" strokeWidth={1.5} />
                <span className="font-mono text-xs text-purple-300">{email}</span>
              </div>
              <span className="text-xs text-slate-500">{dupes.length} duplicate{dupes.length > 1 ? 's' : ''}</span>
            </div>

            {/* Duplicate entries */}
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-500 font-medium text-xs uppercase tracking-wider py-2 px-3">Name</TableHead>
                  <TableHead className="text-slate-500 font-medium text-xs uppercase tracking-wider py-2 px-3">Company</TableHead>
                  <TableHead className="text-slate-500 font-medium text-xs uppercase tracking-wider py-2 px-3">City / State</TableHead>
                  <TableHead className="text-slate-500 font-medium text-xs uppercase tracking-wider py-2 px-3">Phone</TableHead>
                  <TableHead className="text-slate-500 font-medium text-xs uppercase tracking-wider py-2 px-3">Duplicate Source</TableHead>
                  <TableHead className="text-slate-500 font-medium text-xs uppercase tracking-wider py-2 px-3">Kept From</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dupes.map((d, i) => (
                  <TableRow key={d.id || i} className="border-slate-800/50 hover:bg-slate-800/20 text-sm text-slate-300">
                    <TableCell className="py-2 px-3 whitespace-nowrap">
                      {d.first_name || d.last_name ? `${d.first_name} ${d.last_name}`.trim() : <span className="text-slate-600">-</span>}
                    </TableCell>
                    <TableCell className="py-2 px-3">{d.company || <span className="text-slate-600">-</span>}</TableCell>
                    <TableCell className="py-2 px-3 whitespace-nowrap">
                      {d.city || d.state ? `${d.city}${d.city && d.state ? ', ' : ''}${d.state}` : <span className="text-slate-600">-</span>}
                    </TableCell>
                    <TableCell className="py-2 px-3 font-mono text-xs">{d.phone || <span className="text-slate-600">-</span>}</TableCell>
                    <TableCell className="py-2 px-3">
                      <span className="inline-flex items-center gap-1 text-xs bg-red-500/10 text-red-400 border border-red-500/20 rounded-sm px-2 py-0.5">
                        {d.duplicate_source}
                      </span>
                    </TableCell>
                    <TableCell className="py-2 px-3">
                      <span className="inline-flex items-center gap-1 text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-sm px-2 py-0.5">
                        {d.kept_source}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
      </div>
    </div>
  );
}
