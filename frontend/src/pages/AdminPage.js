import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Save, Loader2, Key, Cpu, Shield, Hash, Lock, HardDrive, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import Header from '@/components/Header';
import { useAuth } from '@/contexts/AuthContext';

export default function AdminPage() {
  const { user, clearMustChangePassword } = useAuth();
  const navigate = useNavigate();
  const [config, setConfig] = useState({
    ai_model: 'claude-sonnet', claude_api_key: '', openai_api_key: '',
    max_pdfs_per_upload: 7000, storage_max_mb: 750, storage_target_mb: 300,
    claude_api_key_set: false, openai_api_key_set: false,
  });
  const [storage, setStorage] = useState(null);
  const [diskUsage, setDiskUsage] = useState(null);
  const [clearingStaging, setClearingStaging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  const fetchStorage = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/storage');
      setStorage(data);
    } catch {}
  }, []);

  const fetchDiskUsage = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/disk-usage');
      setDiskUsage(data);
    } catch {}
  }, []);

  const handleClearStaging = async () => {
    setClearingStaging(true);
    try {
      const { data } = await api.post('/admin/disk-usage/clear-staging');
      toast.success(`Staging cleared — freed ${data.freed_mb} MB`);
      await fetchDiskUsage();
    } catch { toast.error('Failed to clear staging'); }
    setClearingStaging(false);
  };

  useEffect(() => {
    if (user && user.role !== 'admin') { navigate('/'); return; }
    (async () => {
      try { const { data } = await api.get('/admin/settings'); setConfig(data); } catch {}
      await fetchStorage();
      await fetchDiskUsage();
      setLoading(false);
    })();
  }, [user, navigate, fetchStorage, fetchDiskUsage]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/admin/settings', {
        ai_model: config.ai_model,
        claude_api_key: config.claude_api_key || undefined,
        openai_api_key: config.openai_api_key || undefined,
        max_pdfs_per_upload: config.max_pdfs_per_upload,
        storage_max_mb: config.storage_max_mb,
        storage_target_mb: config.storage_target_mb,
        budget_ceiling_usd: config.budget_ceiling_usd,
        consecutive_failure_threshold: config.consecutive_failure_threshold,
        retry_max_attempts: config.retry_max_attempts,
      });
      toast.success('Admin settings saved');
      const { data } = await api.get('/admin/settings');
      setConfig(data);
    } catch { toast.error('Failed to save'); }
    setSaving(false);
  };

  const handleCleanup = async () => {
    setCleaning(true);
    try {
      const { data } = await api.post('/admin/storage/cleanup');
      if (data.deleted_count > 0) {
        toast.success(`Freed ${data.freed_mb}MB by removing ${data.deleted_count} oldest files`);
      } else {
        toast.info('Storage is within limits — nothing to clean up');
      }
      await fetchStorage();
    } catch { toast.error('Cleanup failed'); }
    setCleaning(false);
  };

  const handleChangePassword = async () => {
    if (newPw !== confirmPw) { toast.error('New passwords do not match'); return; }
    if (newPw.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    setChangingPw(true);
    try {
      await api.post('/auth/change-password', { current_password: currentPw, new_password: newPw });
      toast.success('Password changed');
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      clearMustChangePassword();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to change password'); }
    setChangingPw(false);
  };

  if (loading) {
    return (<div className="min-h-screen bg-[#0A0F1C]"><Header /><div className="flex items-center justify-center py-32"><Loader2 className="h-6 w-6 text-sky-500 animate-spin" /></div></div>);
  }

  const storagePercent = storage ? Math.min(100, Math.round((storage.total_mb / storage.max_mb) * 100)) : 0;
  const storageColor = storagePercent > 90 ? 'bg-red-500' : storagePercent > 70 ? 'bg-amber-500' : 'bg-emerald-500';

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
              <Input data-testid="current-password-input" type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} placeholder="Enter current password" className="bg-[#0A0F1C] border-slate-800 text-slate-300 placeholder:text-slate-600" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">New Password</label>
              <Input data-testid="new-password-input" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Enter new password (min 6 chars)" className="bg-[#0A0F1C] border-slate-800 text-slate-300 placeholder:text-slate-600" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Confirm New Password</label>
              <Input data-testid="confirm-password-input" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="Re-enter new password" className="bg-[#0A0F1C] border-slate-800 text-slate-300 placeholder:text-slate-600" />
            </div>
            <button onClick={handleChangePassword} disabled={changingPw || !currentPw || !newPw || !confirmPw}
              className="bg-sky-500 hover:bg-sky-600 text-white rounded-sm px-5 py-2 text-sm font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50" data-testid="change-password-button">
              {changingPw ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Change Password
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
            <SelectTrigger className="bg-[#0A0F1C] border-slate-800 text-slate-300" data-testid="admin-ai-model-select"><SelectValue /></SelectTrigger>
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
            <Input data-testid="admin-claude-key-input" type="password" value={config.claude_api_key} onChange={e => setConfig(s => ({ ...s, claude_api_key: e.target.value }))}
              placeholder={config.claude_api_key_set ? "Key is set (enter new to replace)" : "sk-ant-..."} className="bg-[#0A0F1C] border-slate-800 text-slate-300 placeholder:text-slate-600 font-mono text-xs" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">OpenAI API Key</label>
            <Input data-testid="admin-openai-key-input" type="password" value={config.openai_api_key} onChange={e => setConfig(s => ({ ...s, openai_api_key: e.target.value }))}
              placeholder={config.openai_api_key_set ? "Key is set (enter new to replace)" : "sk-..."} className="bg-[#0A0F1C] border-slate-800 text-slate-300 placeholder:text-slate-600 font-mono text-xs" />
          </div>
        </section>

        {/* Upload Limits */}
        <section className="bg-[#111827] border border-slate-800 rounded-sm p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Hash className="h-4 w-4 text-emerald-400" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Upload Limits</h2>
          </div>
          <p className="text-xs text-slate-500">Maximum number of files (PDF/DOCX/XLSX/etc., directly or via ZIP) a user can upload in a single batch. If a batch exceeds this cap the entire upload is rejected with a clear error — no files are silently dropped. Range: 1–10,000.</p>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Max files per upload</label>
            <Input data-testid="max-pdfs-input" type="number" min={1} max={10000} value={config.max_pdfs_per_upload}
              onChange={e => setConfig(s => ({ ...s, max_pdfs_per_upload: parseInt(e.target.value) || 7000 }))} className="bg-[#0A0F1C] border-slate-800 text-slate-300 w-32 font-mono" />
          </div>
        </section>

        {/* Safety Controls (P0 prework) */}
        <section className="bg-[#111827] border border-slate-800 rounded-sm p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="h-4 w-4 text-rose-400" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Large-Run Safety Controls</h2>
          </div>
          <p className="text-xs text-slate-500">Applies to ALL runs. The pipeline auto-pauses when any threshold is breached; click Retry on the run to resume.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Budget ceiling (USD)</label>
              <Input data-testid="budget-ceiling-input" type="number" min={1} max={10000} step={1}
                value={config.budget_ceiling_usd ?? 100}
                onChange={e => setConfig(s => ({ ...s, budget_ceiling_usd: parseFloat(e.target.value) || 100 }))}
                className="bg-[#0A0F1C] border-slate-800 text-slate-300 font-mono" />
              <p className="text-[10px] text-slate-600 mt-1">Auto-pause when approximate cost reaches this amount</p>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Consecutive failure threshold</label>
              <Input data-testid="failure-threshold-input" type="number" min={3} max={200}
                value={config.consecutive_failure_threshold ?? 10}
                onChange={e => setConfig(s => ({ ...s, consecutive_failure_threshold: parseInt(e.target.value) || 10 }))}
                className="bg-[#0A0F1C] border-slate-800 text-slate-300 font-mono" />
              <p className="text-[10px] text-slate-600 mt-1">Auto-pause after N files fail back-to-back</p>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">LLM retry attempts per file</label>
              <Input data-testid="retry-attempts-input" type="number" min={1} max={10}
                value={config.retry_max_attempts ?? 4}
                onChange={e => setConfig(s => ({ ...s, retry_max_attempts: parseInt(e.target.value) || 4 }))}
                className="bg-[#0A0F1C] border-slate-800 text-slate-300 font-mono" />
              <p className="text-[10px] text-slate-600 mt-1">Exponential backoff: 2s → 10s → 30s → 60s → 120s</p>
            </div>
          </div>
        </section>

        {/* Container Disk Utilization */}
        <section className="bg-[#111827] border border-slate-800 rounded-sm p-6 space-y-4" data-testid="disk-usage-section">
          <div className="flex items-center gap-2 mb-2">
            <HardDrive className="h-4 w-4 text-cyan-400" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Container Disk Utilization</h2>
          </div>
          <p className="text-xs text-slate-500">
            Disk usage inside the running pod. When <span className="text-slate-300 font-mono">/app</span> or <span className="text-slate-300 font-mono">/tmp</span> approach 100%, uploads and LibreOffice conversions may fail. Clear the chunked-upload staging dir first, then consider deleting old runs.
          </p>
          {diskUsage?.mounts?.map(m => {
            if (m.error) return (
              <div key={m.path} className="text-xs text-red-400">{m.label}: {m.error}</div>
            );
            const pct = m.percent_used || 0;
            const color = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : pct >= 50 ? 'bg-sky-500' : 'bg-emerald-500';
            const text = pct >= 90 ? 'text-red-400' : pct >= 75 ? 'text-amber-400' : 'text-slate-300';
            return (
              <div key={m.path} className="space-y-1.5" data-testid={`disk-mount-${m.path.replace(/\//g,'_')}`}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-mono">{m.label}</span>
                  <span className={text}>
                    <span className="font-semibold" data-testid={`disk-pct-${m.path.replace(/\//g,'_')}`}>{pct}%</span>
                    <span className="text-slate-600"> · {m.used_gb} / {m.total_gb} GB · {m.free_gb} GB free</span>
                  </span>
                </div>
                <div className="bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div className={`${color} h-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
          {diskUsage && (
            <div className="flex items-center justify-between pt-3 border-t border-slate-800 text-xs">
              <div className="text-slate-500">
                Chunked upload staging: <span className="text-slate-300 font-mono">{diskUsage.chunked_upload_staging_mb} MB</span>
                <span className="text-slate-600 ml-1">({diskUsage.chunked_upload_staging_path})</span>
              </div>
              <button onClick={handleClearStaging} disabled={clearingStaging || diskUsage.chunked_upload_staging_mb === 0}
                className="bg-transparent border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500 hover:text-white rounded-sm px-3 py-1.5 font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-40"
                data-testid="clear-staging-button">
                {clearingStaging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Clear Staging
              </button>
            </div>
          )}
        </section>

        {/* Storage Management */}
        <section className="bg-[#111827] border border-slate-800 rounded-sm p-6 space-y-5">
          <div className="flex items-center gap-2 mb-2">
            <HardDrive className="h-4 w-4 text-purple-400" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">Storage Management</h2>
          </div>

          {/* Usage bar */}
          {storage && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">{storage.total_mb} MB used of {storage.max_mb} MB limit</span>
                <span className="text-slate-500">{storage.file_count} files</span>
              </div>
              <div className="bg-slate-800 rounded-full h-2 overflow-hidden">
                <div className={`${storageColor} h-full transition-all duration-500`} style={{ width: `${storagePercent}%` }} />
              </div>
              {storage.over_limit && (
                <p className="text-xs text-red-400">Storage is over the limit. Oldest files will be auto-purged on next upload, or click cleanup below.</p>
              )}
            </div>
          )}

          <p className="text-xs text-slate-500">
            When total stored PDFs exceed the max limit, the oldest uploaded files are automatically deleted until storage drops to the target. Extracted contact data is never deleted.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Auto-cleanup trigger (MB)</label>
              <Input data-testid="storage-max-input" type="number" min={100} max={10000} value={config.storage_max_mb}
                onChange={e => setConfig(s => ({ ...s, storage_max_mb: parseInt(e.target.value) || 750 }))} className="bg-[#0A0F1C] border-slate-800 text-slate-300 font-mono" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Cleanup target (MB)</label>
              <Input data-testid="storage-target-input" type="number" min={50} max={5000} value={config.storage_target_mb}
                onChange={e => setConfig(s => ({ ...s, storage_target_mb: parseInt(e.target.value) || 300 }))} className="bg-[#0A0F1C] border-slate-800 text-slate-300 font-mono" />
            </div>
          </div>

          <button onClick={handleCleanup} disabled={cleaning}
            className="bg-purple-500/15 border border-purple-500/30 text-purple-300 hover:bg-purple-500 hover:text-white rounded-sm px-5 py-2 text-sm font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50"
            data-testid="manual-cleanup-button">
            {cleaning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Run Cleanup Now
          </button>
        </section>

        {/* Save */}
        <button onClick={handleSave} disabled={saving}
          className="bg-sky-500 hover:bg-sky-600 text-white rounded-sm px-6 py-2.5 font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50" data-testid="admin-save-button">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Admin Settings
        </button>
      </main>
    </div>
  );
}
