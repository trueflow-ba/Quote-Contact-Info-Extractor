import { useState, useRef, useEffect } from 'react';
import { Filter } from 'lucide-react';

export default function ColumnFilter({ columnKey, data, filters, setFilters }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Get unique values for this column
  const uniqueVals = [...new Set(data.map(r => {
    const v = (r[columnKey] || '').trim();
    return v || '(blank)';
  }))].sort((a, b) => a === '(blank)' ? 1 : b === '(blank)' ? -1 : a.localeCompare(b));

  const current = filters[columnKey];
  const hasFilter = current && (current.include?.length > 0 || current.exclude?.length > 0 || current.hideBlanks);
  const filterState = current || {};

  const toggleExclude = (val) => {
    const excl = new Set(filterState.exclude || []);
    if (excl.has(val)) excl.delete(val); else excl.add(val);
    setFilters(prev => ({ ...prev, [columnKey]: { ...prev[columnKey], exclude: [...excl] } }));
  };

  const toggleHideBlanks = () => {
    setFilters(prev => ({
      ...prev,
      [columnKey]: { ...prev[columnKey], hideBlanks: !filterState.hideBlanks }
    }));
  };

  const clearFilter = () => {
    setFilters(prev => {
      const next = { ...prev };
      delete next[columnKey];
      return next;
    });
  };

  if (uniqueVals.length <= 1) return null;
  const showCount = Math.min(uniqueVals.length, 12);
  const excluded = new Set(filterState.exclude || []);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className={`ml-0.5 p-0.5 rounded-sm transition-colors ${hasFilter ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400'}`}
        data-testid={`column-filter-${columnKey}`}
      >
        <Filter className="h-2.5 w-2.5" />
      </button>
      {open && (
        <div
          className="absolute z-50 top-full left-0 mt-1 bg-[#111827] border border-slate-700 rounded-sm shadow-xl min-w-[180px] max-w-[240px] py-1"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Hide blanks toggle */}
          <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800/50 cursor-pointer">
            <input type="checkbox" checked={!!filterState.hideBlanks} onChange={toggleHideBlanks}
              className="rounded border-slate-600 bg-slate-900 text-amber-500 focus:ring-amber-500 h-3 w-3" />
            <span className="text-xs text-amber-400">Hide blanks</span>
          </label>
          <div className="border-t border-slate-800 my-1" />
          {/* Value list */}
          <div className="max-h-48 overflow-y-auto">
            {uniqueVals.slice(0, showCount).map(val => (
              <label key={val} className="flex items-center gap-2 px-3 py-1 hover:bg-slate-800/50 cursor-pointer">
                <input type="checkbox" checked={!excluded.has(val)} onChange={() => toggleExclude(val)}
                  className="rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-sky-500 h-3 w-3" />
                <span className="text-xs text-slate-300 truncate">{val}</span>
              </label>
            ))}
            {uniqueVals.length > showCount && (
              <p className="text-xs text-slate-600 px-3 py-1">+{uniqueVals.length - showCount} more</p>
            )}
          </div>
          {hasFilter && (
            <>
              <div className="border-t border-slate-800 my-1" />
              <button onClick={clearFilter} className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-slate-800/50">
                Clear filter
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Apply column filters to a data array */
export function applyColumnFilters(data, filters) {
  if (!filters || Object.keys(filters).length === 0) return data;
  return data.filter(row => {
    for (const [key, f] of Object.entries(filters)) {
      const val = (row[key] || '').trim();
      const display = val || '(blank)';
      if (f.hideBlanks && !val) return false;
      if (f.exclude?.length > 0 && f.exclude.includes(display)) return false;
    }
    return true;
  });
}
