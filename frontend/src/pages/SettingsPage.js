import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Save, Loader2, Key, Globe, Cpu } from 'lucide-react';
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
      // Re-fetch to update the "set" flags
      const { data } = await api.get('/settings');
      setSettings(data);
    } catch (err) {
      toast.error('Failed to save settings');
    }
    setSaving(false);
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
      </main>
    </div>
  );
}
