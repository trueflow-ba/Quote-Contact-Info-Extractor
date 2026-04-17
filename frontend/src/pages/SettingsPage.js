import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Save, Loader2, Key, Globe, Cpu, Trash2, AlertTriangle } from 'lucide-react';
import api from '@/lib/api';
import Header from '@/components/Header';

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    ai_model: 'claude-sonnet',
    claude_api_key: '',
    openai_api_key: '',
    exclusion_domain: 'horizonc.com',
    claude_api_key_set: false,
    openai_api_key_set: false,
  });
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
      } catch { /* use defaults */ }
      setLoading(false);
    };
    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/settings', {
        ai_model: settings.ai_model,
        claude_api_key: settings.claude_api_key || undefined,
        openai_api_key: settings.openai_api_key || undefined,
        exclusion_domain: settings.exclusion_domain,
      });
      toast.success('Settings saved');
      const { data } = await api.get('/settings');
      setSettings(data);
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
          <p className="text-sm text-slate-500 mt-1">Configure AI models, API keys, and extraction rules.</p>
        </div>

        {/* AI Model */}
        <section className="bg-[#111827] border border-slate-800 rounded-sm p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="h-4 w-4 text-sky-400" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">AI Model</h2>
          </div>
          <p className="text-xs text-slate-500">Select which AI model to use for contact extraction.</p>
          <Select value={settings.ai_model} onValueChange={(v) => setSettings(s => ({ ...s, ai_model: v }))}>
            <SelectTrigger className="bg-[#0A0F1C] border-slate-800 text-slate-300" data-testid="ai-model-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#111827] border-slate-800 text-slate-300">
              <SelectItem value="claude-sonnet">Claude Sonnet (claude-sonnet-4-20250514)</SelectItem>
              <SelectItem value="claude-haiku">Claude Haiku</SelectItem>
              <SelectItem value="gpt-4o">GPT-4o</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-slate-600">
            Default uses TrueFlow's built-in key. Add your own keys below for custom billing.
          </p>
        </section>

        {/* API Keys */}
        <section className="bg-[#111827] border border-slate-800 rounded-sm p-6 space-y-5">
          <div className="flex items-center gap-2 mb-2">
            <Key className="h-4 w-4 text-amber-400" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">API Keys</h2>
          </div>
          <p className="text-xs text-slate-500">Optional. Leave blank to use the built-in key. Only enter your own key if you prefer custom billing.</p>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Claude API Key (Anthropic)</label>
            <Input
              data-testid="claude-api-key-input"
              type="password"
              value={settings.claude_api_key}
              onChange={e => setSettings(s => ({ ...s, claude_api_key: e.target.value }))}
              placeholder={settings.claude_api_key_set ? "Key is set (enter new to replace)" : "sk-ant-..."}
              className="bg-[#0A0F1C] border-slate-800 text-slate-300 placeholder:text-slate-600 font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">OpenAI API Key</label>
            <Input
              data-testid="openai-api-key-input"
              type="password"
              value={settings.openai_api_key}
              onChange={e => setSettings(s => ({ ...s, openai_api_key: e.target.value }))}
              placeholder={settings.openai_api_key_set ? "Key is set (enter new to replace)" : "sk-..."}
              className="bg-[#0A0F1C] border-slate-800 text-slate-300 placeholder:text-slate-600 font-mono text-xs"
            />
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

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-sky-500 hover:bg-sky-600 text-white rounded-sm px-6 py-2.5 font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50"
          data-testid="settings-save-button"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Settings
        </button>

        {/* Data Management - Danger Zone */}
        <section className="bg-[#111827] border border-red-500/20 rounded-sm p-6 space-y-4 mt-12">
          <div className="flex items-center gap-2 mb-2">
            <Trash2 className="h-4 w-4 text-red-400" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wider">Data Management</h2>
          </div>
          <p className="text-xs text-slate-500">
            Permanently delete all your extraction data. Individual runs can be deleted from the Run History tab on the dashboard.
          </p>
          <div className="flex items-start gap-3 bg-red-500/5 border border-red-500/10 rounded-sm p-3">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" strokeWidth={1.5} />
            <p className="text-xs text-slate-400">
              This will delete <strong className="text-slate-300">all runs, contacts, duplicates, error reports, and uploaded file references</strong>. Your account settings will be preserved. This action cannot be undone.
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

      {/* Confirm Delete All Dialog */}
      <Dialog open={showDeleteAll} onOpenChange={(open) => { if (!open) { setShowDeleteAll(false); setDeleteConfirmText(''); } }}>
        <DialogContent className="bg-[#111827] border-slate-800 text-slate-200 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-400 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> Delete All Data
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              This will permanently delete all your extraction runs, contacts, duplicates, error reports, and uploaded file references. Your account and settings will be preserved.
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
            <button
              onClick={() => { setShowDeleteAll(false); setDeleteConfirmText(''); }}
              className="bg-transparent border border-slate-700 text-slate-300 hover:bg-slate-800 rounded-sm px-4 py-2 text-sm transition-colors"
              data-testid="cancel-delete-all"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteAll}
              disabled={deleteConfirmText !== 'DELETE ALL' || deletingAll}
              className="bg-red-500 hover:bg-red-600 text-white rounded-sm px-4 py-2 text-sm font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="confirm-delete-all"
            >
              {deletingAll ? 'Deleting...' : 'Delete Everything'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
