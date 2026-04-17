import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Save, Loader2, Key, Cpu, Shield, Hash, Lock } from 'lucide-react';
import api from '@/lib/api';
import Header from '@/components/Header';
import { useAuth } from '@/contexts/AuthContext';

export default function AdminPage() {
  const { user, clearMustChangePassword } = useAuth();
  const navigate = useNavigate();
  const [config, setConfig] = useState({
    ai_model: 'claude-sonnet',
    claude_api_key: '',
    openai_api_key: '',
    max_pdfs_per_upload: 50,
    claude_api_key_set: false,
    openai_api_key_set: false,
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [changingPw, setChangingPw] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  useEffect(() => {
    if (user && user.role !== 'admin') {
      navigate('/');
      return;
    }
    const fetch = async () => {
      try {
        const { data } = await api.get('/admin/settings');
        setConfig(data);
      } catch {}
      setLoading(false);
    };
    fetch();
  }, [user, navigate]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/admin/settings', {
        ai_model: config.ai_model,
        claude_api_key: config.claude_api_key || undefined,
        openai_api_key: config.openai_api_key || undefined,
        max_pdfs_per_upload: config.max_pdfs_per_upload,
      });
      toast.success('Admin settings saved');
      const { data } = await api.get('/admin/settings');
      setConfig(data);
    } catch {
      toast.error('Failed to save');
    }
    setSaving(false);
  };

  const handleChangePassword = async () => {
    if (newPw !== confirmPw) {
      toast.error('New passwords do not match');
      return;
    }
    if (newPw.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    setChangingPw(true);
    try {
      await api.post('/auth/change-password', {
        current_password: currentPw,
        new_password: newPw,
      });
      toast.success('Password changed');
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      clearMustChangePassword();
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to change password');
    }
    setChangingPw(false);
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
    <div className="min-h-screen bg-[#0A0F1C]" data-testid="admin-page">
      <Header />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-amber-400" strokeWidth={1.5} />
          <div>
            <h1 className="text-2xl font-semibold text-white tracking-tight">Admin Portal</h1>
            <p className="text-sm text-slate-500 mt-0.5">System-wide configuration. Only admin users can access this page.</p>
          </div>
        </div>

        {/* Change Password */}
        <section className="bg-[#111827] border border-slate-800 rounded-sm p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Lock className="h-4 w-4 text-sky-400" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Change Password</h2>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Current Password</label>
              <Input
                data-testid="current-password-input"
                type="password"
                value={currentPw}
                onChange={e => setCurrentPw(e.target.value)}
                placeholder="Enter current password"
                className="bg-[#0A0F1C] border-slate-800 text-slate-300 placeholder:text-slate-600"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">New Password</label>
              <Input
                data-testid="new-password-input"
                type="password"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                placeholder="Enter new password (min 6 chars)"
                className="bg-[#0A0F1C] border-slate-800 text-slate-300 placeholder:text-slate-600"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Confirm New Password</label>
              <Input
                data-testid="confirm-password-input"
                type="password"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                placeholder="Re-enter new password"
                className="bg-[#0A0F1C] border-slate-800 text-slate-300 placeholder:text-slate-600"
              />
            </div>
            <button
              onClick={handleChangePassword}
              disabled={changingPw || !currentPw || !newPw || !confirmPw}
              className="bg-sky-500 hover:bg-sky-600 text-white rounded-sm px-5 py-2 text-sm font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50"
              data-testid="change-password-button"
            >
              {changingPw ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Change Password
            </button>
          </div>
        </section>

        {/* AI Model */}
        <section className="bg-[#111827] border border-slate-800 rounded-sm p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="h-4 w-4 text-sky-400" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">AI Model</h2>
          </div>
          <p className="text-xs text-slate-500">Select which AI model all users will use for contact extraction.</p>
          <Select value={config.ai_model} onValueChange={(v) => setConfig(s => ({ ...s, ai_model: v }))}>
            <SelectTrigger className="bg-[#0A0F1C] border-slate-800 text-slate-300" data-testid="admin-ai-model-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#111827] border-slate-800 text-slate-300">
              <SelectItem value="claude-sonnet">Claude Sonnet (claude-sonnet-4-20250514)</SelectItem>
              <SelectItem value="claude-haiku">Claude Haiku</SelectItem>
              <SelectItem value="gpt-4o">GPT-4o</SelectItem>
            </SelectContent>
          </Select>
        </section>

        {/* API Keys */}
        <section className="bg-[#111827] border border-slate-800 rounded-sm p-6 space-y-5">
          <div className="flex items-center gap-2 mb-2">
            <Key className="h-4 w-4 text-amber-400" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">API Keys</h2>
          </div>
          <p className="text-xs text-slate-500">Leave blank to use the built-in TrueFlow key. Enter your own key for custom billing.</p>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Claude API Key (Anthropic)</label>
            <Input
              data-testid="admin-claude-key-input"
              type="password"
              value={config.claude_api_key}
              onChange={e => setConfig(s => ({ ...s, claude_api_key: e.target.value }))}
              placeholder={config.claude_api_key_set ? "Key is set (enter new to replace)" : "sk-ant-..."}
              className="bg-[#0A0F1C] border-slate-800 text-slate-300 placeholder:text-slate-600 font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">OpenAI API Key</label>
            <Input
              data-testid="admin-openai-key-input"
              type="password"
              value={config.openai_api_key}
              onChange={e => setConfig(s => ({ ...s, openai_api_key: e.target.value }))}
              placeholder={config.openai_api_key_set ? "Key is set (enter new to replace)" : "sk-..."}
              className="bg-[#0A0F1C] border-slate-800 text-slate-300 placeholder:text-slate-600 font-mono text-xs"
            />
          </div>
        </section>

        {/* Upload Limits */}
        <section className="bg-[#111827] border border-slate-800 rounded-sm p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Hash className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Upload Limits</h2>
          </div>
          <p className="text-xs text-slate-500">Maximum number of PDFs a user can upload per run (directly or via ZIP). Files exceeding this limit are rejected.</p>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Max PDFs per upload</label>
            <Input
              data-testid="max-pdfs-input"
              type="number"
              min={1}
              max={500}
              value={config.max_pdfs_per_upload}
              onChange={e => setConfig(s => ({ ...s, max_pdfs_per_upload: parseInt(e.target.value) || 50 }))}
              className="bg-[#0A0F1C] border-slate-800 text-slate-300 w-32 font-mono"
            />
          </div>
        </section>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-sky-500 hover:bg-sky-600 text-white rounded-sm px-6 py-2.5 font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50"
          data-testid="admin-save-button"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Admin Settings
        </button>
      </main>
    </div>
  );
}
