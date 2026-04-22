import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Save, Loader2, Globe, Trash2, AlertTriangle, Info, Download, Upload, Database } from 'lucide-react';
import api from '@/lib/api';
import Header from '@/components/Header';

export default function SettingsPage() {
  const [settings, setSettings] = useState({ exclusion_domain: 'horizonc.com', ai_model: '', max_pdfs_per_upload: 50 });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingAll, setDeletingAll] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data } = await api.get('/settings');
        setSettings(data);
      } catch {}
      setLoading(false);
    };
    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/settings', { exclusion_domain: settings.exclusion_domain });
      toast.success('Settings saved');
    } catch {
      toast.error('Failed to save settings');
    }
    setSaving(false);
  };

  const handleDeleteAll = async () => {
    if (deleteConfirmText !== 'DELETE ALL') return;
    setDeletingAll(true);
    try {
      const { data } = await api.delete('/data/all');
      const d = data.deleted || {};
      toast.success(`Deleted ${d.runs || 0} runs, ${d.contacts || 0} contacts, ${d.errors || 0} errors`);
      setShowDeleteAll(false);
      setDeleteConfirmText('');
    } catch {
      toast.error('Failed to delete data');
    }
    setDeletingAll(false);
  };

  const [importingRegistry, setImportingRegistry] = useState(false);
  const [exportingRegistry, setExportingRegistry] = useState(false);
  const importFileRef = useRef(null);

  const handleExportRegistry = async () => {
    setExportingRegistry(true);
    try {
      const resp = await api.get('/skip-registry/export', { responseType: 'blob' });
      const blob = new Blob([resp.data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = `skip_registry_${dateStr}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Skip registry exported');
    } catch {
      toast.error('Failed to export skip registry');
    }
    setExportingRegistry(false);
  };

  const handleImportRegistry = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingRegistry(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/skip-registry/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`Imported ${data.imported} new hash(es); ${data.skipped_already_known} already known.`);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to import');
    }
    setImportingRegistry(false);
    if (importFileRef.current) importFileRef.current.value = '';
  };

  const modelLabels = { 'claude-sonnet': 'Claude Sonnet', 'claude-haiku': 'Claude Haiku', 'gpt-4o': 'GPT-4o' };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0F1C]">
        <Header />
        <div className="flex items-center justify-center py-32">
          <Loader2 className="h-6 w-6 text-sky-500 animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0F1C]" data-testid="settings-page">
      <Header />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Settings</h1>
          <p className="text-sm text-slate-500 mt-1">Configure your extraction preferences.</p>
        </div>

        {/* System info (read-only) */}
        <section className="bg-[#111827] border border-slate-800 rounded-sm p-6 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <Info className="h-4 w-4 text-sky-400" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">System Configuration</h2>
          </div>
          <p className="text-xs text-slate-500">These settings are managed by the administrator.</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[#0A0F1C] rounded-sm p-3 border border-slate-800/50">
              <p className="text-xs text-slate-500 mb-1">AI Model</p>
              <p className="text-sm text-slate-300 font-medium">{modelLabels[settings.ai_model] || settings.ai_model}</p>
            </div>
            <div className="bg-[#0A0F1C] rounded-sm p-3 border border-slate-800/50">
              <p className="text-xs text-slate-500 mb-1">Max PDFs per Upload</p>
              <p className="text-sm text-slate-300 font-medium font-mono">{settings.max_pdfs_per_upload}</p>
            </div>
          </div>
        </section>

        {/* Exclusion Domain */}
        <section className="bg-[#111827] border border-slate-800 rounded-sm p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Exclusion Domain</h2>
          </div>
          <p className="text-xs text-slate-500">Contacts with email addresses containing this domain will be excluded from results (internal company emails).</p>
          <Input
            data-testid="exclusion-domain-input"
            value={settings.exclusion_domain}
            onChange={e => setSettings(s => ({ ...s, exclusion_domain: e.target.value }))}
            placeholder="horizonc.com"
            className="bg-[#0A0F1C] border-slate-800 text-slate-300 placeholder:text-slate-600"
          />
        </section>

        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-sky-500 hover:bg-sky-600 text-white rounded-sm px-6 py-2.5 font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50"
          data-testid="settings-save-button"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Settings
        </button>

        {/* Skip Registry — portable dedup list */}
        <section className="bg-[#111827] border border-sky-500/20 rounded-sm p-6 space-y-4 mt-12">
          <div className="flex items-center gap-2 mb-2">
            <Database className="h-4 w-4 text-sky-400" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-sky-400 uppercase tracking-wider">Skip Registry (Cross-Run Dedup)</h2>
          </div>
          <p className="text-xs text-slate-500">
            Export a compact CSV listing every file you've analyzed (SHA-256 content hash + filename). Re-import after a container rebuild
            so the app still recognizes already-processed files and skips them — saving LLM cost + time on your next run.
          </p>
          <div className="flex items-start gap-3 bg-sky-500/5 border border-sky-500/10 rounded-sm p-3">
            <Info className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" strokeWidth={1.5} />
            <div className="text-xs text-slate-400 space-y-1">
              <p><strong className="text-slate-300">When to export:</strong> before planned environment shutdown / end of day.</p>
              <p><strong className="text-slate-300">When to import:</strong> first thing after the app restarts, before uploading new batches.</p>
              <p><strong className="text-slate-300">Safe to import repeatedly</strong> — duplicate hashes are silently skipped.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleExportRegistry}
              disabled={exportingRegistry}
              className="bg-sky-500/10 border border-sky-500/20 text-sky-300 hover:bg-sky-500 hover:text-white rounded-sm px-5 py-2 text-sm font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50"
              data-testid="export-skip-registry-button"
            >
              {exportingRegistry ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export Skip Registry
            </button>
            <button
              onClick={() => importFileRef.current?.click()}
              disabled={importingRegistry}
              className="bg-transparent border border-sky-500/20 text-sky-300 hover:bg-sky-500/10 rounded-sm px-5 py-2 text-sm font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50"
              data-testid="import-skip-registry-button"
            >
              {importingRegistry ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Import Skip Registry
            </button>
            <input ref={importFileRef} type="file" accept=".csv" onChange={handleImportRegistry} className="hidden" data-testid="import-skip-registry-input" />
          </div>
        </section>

        {/* Data Management */}
        <section className="bg-[#111827] border border-red-500/20 rounded-sm p-6 space-y-4 mt-12">
          <div className="flex items-center gap-2 mb-2">
            <Trash2 className="h-4 w-4 text-red-400" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wider">Data Management</h2>
          </div>
          <p className="text-xs text-slate-500">
            Permanently delete all your extraction data. Individual runs can be deleted from the Run History tab.
          </p>
          <div className="flex items-start gap-3 bg-red-500/5 border border-red-500/10 rounded-sm p-3">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" strokeWidth={1.5} />
            <p className="text-xs text-slate-400">
              This will delete <strong className="text-slate-300">all runs, contacts, duplicates, error reports, and uploaded file references</strong>. Your account settings will be preserved.
            </p>
          </div>
          <button
            onClick={() => setShowDeleteAll(true)}
            className="bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white rounded-sm px-5 py-2 text-sm font-medium transition-colors inline-flex items-center gap-2"
            data-testid="delete-all-data-button"
          >
            <Trash2 className="h-4 w-4" /> Delete All Data
          </button>
        </section>
      </main>

      <Dialog open={showDeleteAll} onOpenChange={(open) => { if (!open) { setShowDeleteAll(false); setDeleteConfirmText(''); } }}>
        <DialogContent className="bg-[#111827] border-slate-800 text-slate-200 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> Delete All Data
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              This will permanently delete all your extraction runs, contacts, duplicates, error reports, and file references.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-xs text-slate-500">Type <strong className="text-red-400 font-mono">DELETE ALL</strong> to confirm:</p>
            <Input
              data-testid="delete-all-confirm-input"
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder="Type DELETE ALL"
              className="bg-[#0A0F1C] border-slate-800 text-slate-300 placeholder:text-slate-600 font-mono"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <button onClick={() => { setShowDeleteAll(false); setDeleteConfirmText(''); }} className="bg-transparent border border-slate-700 text-slate-300 hover:bg-slate-800 rounded-sm px-4 py-2 text-sm transition-colors" data-testid="cancel-delete-all">Cancel</button>
            <button onClick={handleDeleteAll} disabled={deleteConfirmText !== 'DELETE ALL' || deletingAll} className="bg-red-500 hover:bg-red-600 text-white rounded-sm px-4 py-2 text-sm font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50" data-testid="confirm-delete-all">{deletingAll ? 'Deleting...' : 'Delete Everything'}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
