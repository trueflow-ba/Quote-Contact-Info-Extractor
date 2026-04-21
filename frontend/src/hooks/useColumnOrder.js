import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Hook for draggable reorderable columns with localStorage persistence.
 *
 * Usage:
 *   const { columns, onDragStart, onDragOver, onDrop, getDragProps } = useColumnOrder(defaultColumns, 'contacts-table-columns');
 */
export function useColumnOrder(defaultColumns, storageKey) {
  const [columns, setColumns] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const savedKeys = JSON.parse(saved);
        // Reconstruct: preserve saved order, then append any new cols not in saved
        const defaultByKey = Object.fromEntries(defaultColumns.map(c => [c.key, c]));
        const ordered = savedKeys.filter(k => defaultByKey[k]).map(k => defaultByKey[k]);
        const extras = defaultColumns.filter(c => !savedKeys.includes(c.key));
        return [...ordered, ...extras];
      }
    } catch {}
    return defaultColumns;
  });

  const dragIndexRef = useRef(null);
  const [dragOverKey, setDragOverKey] = useState(null);

  // Persist whenever columns change
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(columns.map(c => c.key)));
    } catch {}
  }, [columns, storageKey]);

  // Re-sync when defaultColumns changes (e.g. switching grouped/flat views)
  // only when the column key set truly changes
  useEffect(() => {
    const defaultKeys = new Set(defaultColumns.map(c => c.key));
    const currentKeys = new Set(columns.map(c => c.key));
    const sameSet = defaultKeys.size === currentKeys.size && [...defaultKeys].every(k => currentKeys.has(k));
    if (!sameSet) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const savedKeys = JSON.parse(saved);
          const defaultByKey = Object.fromEntries(defaultColumns.map(c => [c.key, c]));
          const ordered = savedKeys.filter(k => defaultByKey[k]).map(k => defaultByKey[k]);
          const extras = defaultColumns.filter(c => !savedKeys.includes(c.key));
          setColumns([...ordered, ...extras]);
          return;
        }
      } catch {}
      setColumns(defaultColumns);
    }
  }, [defaultColumns, storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveColumn = useCallback((fromIdx, toIdx) => {
    setColumns(prev => {
      if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return prev;
      const next = [...prev];
      const [item] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, item);
      return next;
    });
  }, []);

  const resetOrder = useCallback(() => {
    setColumns(defaultColumns);
    try { localStorage.removeItem(storageKey); } catch {}
  }, [defaultColumns, storageKey]);

  const getDragProps = (col, idx) => ({
    draggable: true,
    onDragStart: (e) => {
      dragIndexRef.current = idx;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', col.key); } catch {}
    },
    onDragOver: (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragOverKey !== col.key) setDragOverKey(col.key);
    },
    onDragLeave: () => {
      if (dragOverKey === col.key) setDragOverKey(null);
    },
    onDrop: (e) => {
      e.preventDefault();
      const from = dragIndexRef.current;
      if (from !== null && from !== idx) moveColumn(from, idx);
      dragIndexRef.current = null;
      setDragOverKey(null);
    },
    onDragEnd: () => {
      dragIndexRef.current = null;
      setDragOverKey(null);
    },
  });

  return { columns, setColumns, getDragProps, dragOverKey, resetOrder, moveColumn };
}
