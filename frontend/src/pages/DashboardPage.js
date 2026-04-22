import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, Zap, Pause, Play, XCircle } from 'lucide-react';
import api from '@/lib/api';
import Header from '@/components/Header';
import StatsCards from '@/components/StatsCards';
import UploadZone from '@/components/UploadZone';
import ContactsTable from '@/components/ContactsTable';
import ErrorsTable from '@/components/ErrorsTable';
import DuplicatesTable from '@/components/DuplicatesTable';
import AllContactsTable from '@/components/AllContactsTable';
import RunHistory from '@/components/RunHistory';
import MasterIndexTab from '@/components/MasterIndexTab';
import DataViz from '@/components/DataViz';

export default function DashboardPage() {
  const [runs, setRuns] = useState([]);
  const [currentRunId, setCurrentRunId] = useState(null);
  const [currentRun, setCurrentRun] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [errors, setErrors] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [chartData, setChartData] = useState(null);
  const [files, setFiles] = useState([]);
  const [progress, setProgress] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const pollRef = useRef(null);

  // -- Refresh helpers (no deps on other callbacks) --
  const refreshRunData = useCallback(async (runId) => {
    try {
      const [r, c, e, d, ch] = await Promise.all([
        api.get(`/runs/${runId}`), api.get(`/runs/${runId}/contacts`),
        api.get(`/runs/${runId}/errors`), api.get(`/runs/${runId}/duplicates`),
        api.get(`/runs/${runId}/charts`),
      ]);
      setCurrentRun(r.data);
      setContacts(c.data);
      setErrors(e.data);
      setDuplicates(d.data);
      setChartData(ch.data);
    } catch {}
  }, []);

  const refreshRuns = useCallback(async () => {
    try {
      const { data } = await api.get('/runs');
      setRuns(data);
      return data;
    } catch { return []; }
  }, []);

  // -- Polling: self-contained, refreshes tables periodically during processing --
  const pollCountRef = useRef(0);
  const startPolling = useCallback((runId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollCountRef.current = 0;
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/progress/${runId}`);
        setProgress(data);
        pollCountRef.current += 1;

        // Every 5th poll (~10 sec), refresh the live tables
        if (data.status === 'processing' && pollCountRef.current % 5 === 0) {
          try {
            const [c, e] = await Promise.all([
              api.get(`/runs/${runId}/contacts`),
              api.get(`/runs/${runId}/errors`),
            ]);
            setContacts(c.data);
            setErrors(e.data);
          } catch {}
        }

        if (['completed', 'failed', 'stale', 'paused', 'cancelled'].includes(data.status)) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setIsProcessing(false);
          if (data.status === 'completed') toast.success('Extraction complete!');
          else if (data.status === 'paused') toast.info('Extraction paused');
          else if (data.status === 'cancelled') toast.info('Extraction cancelled');
          else if (data.status === 'failed') toast.error('Processing failed: ' + (data.message || ''));
          // Full refresh on completion
          try {
            const [r, c, e, d, ch] = await Promise.all([
              api.get(`/runs/${runId}`), api.get(`/runs/${runId}/contacts`),
              api.get(`/runs/${runId}/errors`), api.get(`/runs/${runId}/duplicates`),
              api.get(`/runs/${runId}/charts`),
            ]);
            setCurrentRun(r.data); setContacts(c.data); setErrors(e.data);
            setDuplicates(d.data); setChartData(ch.data);
          } catch {}
          try { const { data: allRuns } = await api.get('/runs'); setRuns(allRuns); } catch {}
          if (data.status === 'completed' || data.status === 'cancelled') setProgress(null);
        }
      } catch {}
    }, 2000);
  }, []);

  // -- Initial load: fetch runs, pick latest --
  useEffect(() => {
    (async () => {
      const data = await refreshRuns();
      if (data.length > 0) {
        setCurrentRunId(data[0].id);
        setCurrentRun(data[0]);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // -- When currentRunId changes, load that run's data + check for active progress --
  useEffect(() => {
    if (!currentRunId) return;
    (async () => {
      await refreshRunData(currentRunId);
      try {
        const { data: prog } = await api.get(`/progress/${currentRunId}`);
        if (prog && prog.status === 'paused') {
          setProgress(prog);
        } else if (prog && prog.status === 'processing') {
          setProgress(prog);
          setIsProcessing(true);
          startPolling(currentRunId);
        }
      } catch {}
    })();
  }, [currentRunId, refreshRunData, startPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // -- Actions --
  const selectRun = (runId) => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setIsProcessing(false);
    setProgress(null);
    setCurrentRunId(runId);
    const run = runs.find(r => r.id === runId);
    if (run) setCurrentRun(run);
  };

  const deleteRun = (runId) => {
    const updated = runs.filter(r => r.id !== runId);
    setRuns(updated);
    if (currentRunId === runId) {
      if (updated.length > 0) { setCurrentRunId(updated[0].id); setCurrentRun(updated[0]); }
      else { setCurrentRunId(null); setCurrentRun(null); setContacts([]); setErrors([]); setDuplicates([]); setChartData(null); }
    }
  };

  const retryRun = (runId) => {
    setCurrentRunId(runId);
    setIsProcessing(true);
    setProgress({ status: 'processing', percentage: 0, message: 'Restarting extraction...' });
    startPolling(runId);
  };

  const CHUNK_SIZE = 25 * 1024 * 1024; // 25 MB per chunk — safely under ingress limit
  const CHUNK_THRESHOLD = 200 * 1024 * 1024; // Use chunked upload when any single file > 200 MB

  const uploadSingleFileInChunks = async (file, onProgress) => {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const { data: initRes } = await api.post('/upload/chunk/init', {
      filename: file.name, total_size: file.size, total_chunks: totalChunks
    });
    const uploadId = initRes.upload_id;
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const blob = file.slice(start, end);
      const fd = new FormData();
      fd.append('index', String(i));
      fd.append('chunk', blob, `chunk_${i}`);
      await api.post(`/upload/chunk/${uploadId}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000
      });
      if (onProgress) onProgress(Math.round(((i + 1) / totalChunks) * 100));
    }
    const { data } = await api.post(`/upload/chunk/${uploadId}/complete`, {}, { timeout: 300000 });
    return data;
  };

  const handleExtract = async () => {
    if (files.length === 0) { toast.error('Please select files to upload'); return; }
    setIsUploading(true);
    try {
      const useChunked = files.length === 1 && files[0].size > CHUNK_THRESHOLD;
      let uploadData;
      if (useChunked) {
        const f = files[0];
        setProgress({ status: 'uploading', percentage: 0, message: `Uploading large file in chunks (0%)...` });
        uploadData = await uploadSingleFileInChunks(f, (pct) => {
          setProgress({ status: 'uploading', percentage: Math.round(pct * 0.5), message: `Uploading large file in chunks (${pct}%)...` });
        });
      } else {
        const formData = new FormData();
        files.forEach(f => formData.append('files', f));
        const resp = await api.post('/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 300000
        });
        uploadData = resp.data;
      }
      const runId = uploadData.run_id;
      setCurrentRunId(runId);
      setFiles([]);
      if (uploadData.rejected_count) {
        toast.warning(`${uploadData.total_files} PDF(s) accepted. ${uploadData.rejected_count} rejected (limit: ${uploadData.max_pdfs}).`);
      } else {
        toast.success(`${uploadData.total_files} PDF(s) — uploading to storage...`);
      }
      setIsUploading(false);
      setIsProcessing(true);
      setProgress({ status: 'uploading', percentage: 50, message: 'Uploading PDFs to storage...' });

      // Poll until upload finishes, then auto-start extraction
      const uploadPoll = setInterval(async () => {
        try {
          const { data: prog } = await api.get(`/progress/${runId}`);
          setProgress(prog);
          if (prog.status === 'uploaded') {
            clearInterval(uploadPoll);
            // Auto-start extraction
            setProgress({ status: 'processing', percentage: 50, message: 'Starting extraction...' });
            await api.post(`/extract/${runId}`);
            startPolling(runId);
          } else if (prog.status === 'failed') {
            clearInterval(uploadPoll);
            setIsProcessing(false);
            toast.error('Upload to storage failed: ' + (prog.message || ''));
          }
        } catch {}
      }, 2000);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const status = err?.response?.status;
      if (status === 413) {
        toast.error('File too large for direct upload. Try reducing ZIP size or splitting further.');
      } else {
        toast.error(detail || err?.message || 'Upload failed');
      }
      setIsUploading(false);
      setIsProcessing(false);
    }
  };

  const handlePause = async () => {
    if (!currentRunId) return;
    try { await api.post(`/runs/${currentRunId}/pause`); toast.info('Pausing after current file...'); }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed to pause'); }
  };

  const handleResume = async () => {
    if (!currentRunId) return;
    try {
      setIsProcessing(true);
      setProgress(p => ({ ...p, status: 'processing', message: 'Resuming...' }));
      await api.post(`/extract/${currentRunId}`);
      startPolling(currentRunId);
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to resume'); setIsProcessing(false); }
  };

  const handleCancel = async () => {
    if (!currentRunId) return;
    try { await api.post(`/runs/${currentRunId}/cancel`); toast.info('Cancelling extraction...'); }
    catch (err) { toast.error(err.response?.data?.detail || 'Failed to cancel'); }
  };

  return (
    <div className="min-h-screen bg-[#0A0F1C]" data-testid="dashboard-page">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <StatsCards stats={currentRun?.stats} />

        <div className="space-y-4">
          <UploadZone files={files} setFiles={setFiles} />

          {/* Progress bar + controls */}
          {progress && ['uploading', 'processing', 'paused', 'pausing', 'cancelling'].includes(progress.status) && (
            <div className="bg-[#111827] border border-slate-800 rounded-sm p-4" data-testid="progress-container">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-300">{progress.message || 'Processing...'}</span>
                <span className="text-sm font-mono text-amber-400">{progress.percentage || 0}%</span>
              </div>
              <div className="bg-slate-800 rounded-full h-1.5 overflow-hidden w-full">
                <div
                  className={`h-full transition-all duration-300 ease-out ${progress.status === 'paused' ? 'bg-sky-400' : progress.status === 'uploading' ? 'bg-sky-500' : 'bg-amber-500'}`}
                  style={{ width: `${progress.percentage || 0}%`, boxShadow: progress.status === 'paused' ? '0 0 8px rgba(14,165,233,0.5)' : progress.status === 'uploading' ? '0 0 8px rgba(14,165,233,0.3)' : '0 0 8px rgba(245,158,11,0.5)' }}
                />
              </div>
              {progress.current_file && progress.status === 'processing' && (
                <p className="text-xs text-slate-500 mt-2 font-mono">{progress.current_file}</p>
              )}
              <div className="flex items-center gap-2 mt-3">
                {['processing', 'pausing'].includes(progress.status) && (
                  <button onClick={handlePause} disabled={progress.status === 'pausing'}
                    className="bg-transparent border border-sky-500/30 text-sky-400 hover:bg-sky-500 hover:text-white rounded-sm px-4 py-1.5 text-sm font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50"
                    data-testid="pause-extraction-button">
                    <Pause className="h-3.5 w-3.5" /> {progress.status === 'pausing' ? 'Pausing...' : 'Pause'}
                  </button>
                )}
                {progress.status === 'paused' && (
                  <button onClick={handleResume}
                    className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500 hover:text-white rounded-sm px-4 py-1.5 text-sm font-medium transition-colors inline-flex items-center gap-2"
                    data-testid="resume-extraction-button">
                    <Play className="h-3.5 w-3.5" /> Resume
                  </button>
                )}
                {['processing', 'pausing', 'paused'].includes(progress.status) && (
                  <button onClick={handleCancel} disabled={progress.status === 'cancelling'}
                    className="bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white rounded-sm px-4 py-1.5 text-sm font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50"
                    data-testid="cancel-extraction-button">
                    <XCircle className="h-3.5 w-3.5" /> Cancel
                  </button>
                )}
              </div>
            </div>
          )}

          {files.length > 0 && !isProcessing && (
            <button onClick={handleExtract} disabled={isUploading}
              className="bg-sky-500 hover:bg-sky-600 text-white rounded-sm px-6 py-2.5 font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50"
              data-testid="extract-contacts-button">
              {isUploading ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading...</> : <><Zap className="h-4 w-4" /> Extract Contacts</>}
            </button>
          )}
        </div>

        <DataViz chartData={chartData} />

        <Tabs defaultValue="all" className="w-full">
          <TabsList className="bg-[#111827] border border-slate-800 p-1 h-auto rounded-sm flex-wrap">
            <TabsTrigger value="all" className="text-sm data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-400 data-[state=active]:shadow-none text-slate-400 rounded-sm px-4 py-1.5" data-testid="tab-all-contacts">
              All Contacts
            </TabsTrigger>
            <TabsTrigger value="results" className="text-sm data-[state=active]:bg-sky-500/10 data-[state=active]:text-sky-400 data-[state=active]:shadow-none text-slate-400 rounded-sm px-4 py-1.5" data-testid="tab-results">
              This Run {contacts.length > 0 && `(${contacts.length})`}
            </TabsTrigger>
            <TabsTrigger value="duplicates" className="text-sm data-[state=active]:bg-purple-500/10 data-[state=active]:text-purple-400 data-[state=active]:shadow-none text-slate-400 rounded-sm px-4 py-1.5" data-testid="tab-duplicates">
              Duplicates {duplicates.length > 0 && `(${duplicates.length})`}
            </TabsTrigger>
            <TabsTrigger value="issues" className="text-sm data-[state=active]:bg-amber-500/10 data-[state=active]:text-amber-400 data-[state=active]:shadow-none text-slate-400 rounded-sm px-4 py-1.5" data-testid="tab-issues">
              Processing Issues {errors.length > 0 && `(${errors.length})`}
            </TabsTrigger>
            <TabsTrigger value="history" className="text-sm data-[state=active]:bg-slate-700/50 data-[state=active]:text-slate-200 data-[state=active]:shadow-none text-slate-400 rounded-sm px-4 py-1.5" data-testid="tab-history">
              Run History {runs.length > 0 && `(${runs.length})`}
            </TabsTrigger>
            <TabsTrigger value="master" className="text-sm data-[state=active]:bg-cyan-500/10 data-[state=active]:text-cyan-300 data-[state=active]:shadow-none text-slate-400 rounded-sm px-4 py-1.5" data-testid="tab-master-index">
              Master Index
            </TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="mt-4 animate-fade-in"><AllContactsTable /></TabsContent>
          <TabsContent value="results" className="mt-4 animate-fade-in"><ContactsTable contacts={contacts} runId={currentRunId} runStats={currentRun?.stats} duplicatesCount={duplicates.length} errorsCount={errors.length} /></TabsContent>
          <TabsContent value="duplicates" className="mt-4 animate-fade-in"><DuplicatesTable duplicates={duplicates} /></TabsContent>
          <TabsContent value="issues" className="mt-4 animate-fade-in"><ErrorsTable errors={errors} runId={currentRunId} /></TabsContent>
          <TabsContent value="history" className="mt-4 animate-fade-in"><RunHistory runs={runs} onSelectRun={selectRun} onDeleteRun={deleteRun} onRetryRun={retryRun} currentRunId={currentRunId} /></TabsContent>
          <TabsContent value="master" className="mt-4 animate-fade-in"><MasterIndexTab /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
