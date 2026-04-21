import { useState, useRef, useEffect, useMemo } from 'react';
import { Filter, Search as SearchIcon } from 'lucide-react';

export default function ColumnFilter({ columnKey, data, filters, setFilters }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Reset search when dropdown closes
  useEffect(() => { if (!open) setSearch(''); }, [open]);

  // Get unique values for this column
  const uniqueVals = useMemo(() => {
    return [...new Set(data.map(r => {
      const v = (r[columnKey] || '').toString().trim();
      return v || '(blank)';
    }))].sort((a, b) => a === '(blank)' ? 1 : b === '(blank)' ? -1 : a.localeCompare(b));
  }, [data, columnKey]);

  const current = filters[columnKey];
  const hasFilter = current && (current.include?.length > 0 || current.exclude?.length > 0 || current.hideBlanks);
  const filterState = current || {};

  const visibleVals = useMemo(() => {
    if (!search.trim()) return uniqueVals;
    const q = search.toLowerCase();
    return uniqueVals.filter(v => v.toLowerCase().includes(q));
  }, [uniqueVals, search]);

  const excluded = new Set(filterState.exclude || []);

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

  // Select all VISIBLE values (include them by removing from exclude list)
  const selectAllVisible = () => {
    const excl = new Set(filterState.exclude || []);
    visibleVals.forEach(v => excl.delete(v));
    setFilters(prev => ({ ...prev, [columnKey]: { ...prev[columnKey], exclude: [...excl] } }));
  };

  // Deselect all VISIBLE values (add to exclude list)
  const clearAllVisible = () => {
    const excl = new Set(filterState.exclude || []);
    visibleVals.forEach(v => excl.add(v));
    setFilters(prev => ({ ...prev, [columnKey]: { ...prev[columnKey], exclude: [...excl] } }));
  };

  if (uniqueVals.length <= 1) return null;

  // Are all visible values currently selected (i.e. not excluded)?
  const allVisibleSelected = visibleVals.length > 0 && visibleVals.every(v => !excluded.has(v));
  const anyVisibleSelected = visibleVals.some(v => !excluded.has(v));

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
          className="absolute z-50 top-full left-0 mt-1 bg-[#111827] border border-slate-700 rounded-sm shadow-xl w-[260px] py-1"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Search bar */}
          <div className="px-2 pt-2 pb-1">
            <div className="relative">
              <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search values..."
                className="w-full pl-7 pr-2 py-1 text-xs bg-slate-900 border border-slate-700 rounded-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                data-testid={`column-filter-search-${columnKey}`}
                autoFocus
              />
            </div>
          </div>

          {/* Select all / Clear all */}
          <div className="flex items-center justify-between px-3 py-1.5 border-y border-slate-800 bg-slate-900/40">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                ref={(el) => { if (el) el.indeterminate = anyVisibleSelected && !allVisibleSelected; }}
                onChange={() => allVisibleSelected ? clearAllVisible() : selectAllVisible()}
                className="rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-sky-500 h-3 w-3"
                data-testid={`column-filter-toggle-all-${columnKey}`}
              />
              <span className="text-xs text-slate-300 font-medium">
                {allVisibleSelected ? 'Clear all' : 'Select all'}
                {search.trim() && <span className="text-slate-500"> (visible)</span>}
              </span>
            </label>
            <span className="text-[10px] text-slate-500">{visibleVals.length}/{uniqueVals.length}</span>
          </div>

          {/* Hide blanks toggle */}
          <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-800/50 cursor-pointer">
            <input type="checkbox" checked={!!filterState.hideBlanks} onChange={toggleHideBlanks}
              className="rounded border-slate-600 bg-slate-900 text-amber-500 focus:ring-amber-500 h-3 w-3" />
            <span className="text-xs text-amber-400">Hide blanks</span>
          </label>
          <div className="border-t border-slate-800" />

          {/* Value list */}
          <div className="max-h-56 overflow-y-auto">
            {visibleVals.length === 0 ? (
              <p className="text-xs text-slate-600 px-3 py-3 text-center">No matching values</p>
            ) : (
              visibleVals.map(val => (
                <label key={val} className="flex items-center gap-2 px-3 py-1 hover:bg-slate-800/50 cursor-pointer">
                  <input type="checkbox" checked={!excluded.has(val)} onChange={() => toggleExclude(val)}
                    className="rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-sky-500 h-3 w-3"
                    data-testid={`column-filter-item-${columnKey}-${val.replace(/\s+/g, '-').slice(0, 20)}`} />
                  <span className="text-xs text-slate-300 truncate" title={val}>{val}</span>
                </label>
              ))
            )}
          </div>

          {hasFilter && (
            <>
              <div className="border-t border-slate-800" />
              <button onClick={clearFilter} className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-slate-800/50" data-testid={`column-filter-reset-${columnKey}`}>
                Reset filter
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
      const val = (row[key] || '').toString().trim();
      const display = val || '(blank)';
      if (f.hideBlanks && !val) return false;
      if (f.exclude?.length > 0 && f.exclude.includes(display)) return false;
    }
    return true;
  });
}
