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
import RunHistory from '@/components/RunHistory';
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

  const fetchRuns = useCallback(async () => {
    try {
      const { data } = await api.get('/runs');
      setRuns(data);
      if (data.length > 0 && !currentRunId) {
        const latest = data[0];
        setCurrentRunId(latest.id);
        setCurrentRun(latest);
      }
    } catch { /* silent */ }
  }, [currentRunId]);

  const fetchRunData = useCallback(async (runId) => {
    try {
      const [runResp, contactsResp, errorsResp, dupesResp, chartsResp, progressResp] = await Promise.all([
        api.get(`/runs/${runId}`),
        api.get(`/runs/${runId}/contacts`),
        api.get(`/runs/${runId}/errors`),
        api.get(`/runs/${runId}/duplicates`),
        api.get(`/runs/${runId}/charts`),
        api.get(`/progress/${runId}`),
      ]);
      setCurrentRun(runResp.data);
      setContacts(contactsResp.data);
      setErrors(errorsResp.data);
      setDuplicates(dupesResp.data);
      setChartData(chartsResp.data);
      // Restore progress state for paused/processing runs
      const prog = progressResp.data;
      if (prog && ['paused', 'processing'].includes(prog.status)) {
        setProgress(prog);
        if (prog.status === 'processing') {
          setIsProcessing(true);
          if (!pollRef.current) {
            pollRef.current = setInterval(() => pollProgress(runId), 2000);
          }
        }
      }
    } catch { /* silent */ }
  }, [pollProgress]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  useEffect(() => {
    if (currentRunId) fetchRunData(currentRunId);
  }, [currentRunId, fetchRunData]);

  const selectRun = (runId) => {
    setCurrentRunId(runId);
    const run = runs.find(r => r.id === runId);
    if (run) setCurrentRun(run);
  };

  const deleteRun = (runId) => {
    const updated = runs.filter(r => r.id !== runId);
    setRuns(updated);
    if (currentRunId === runId) {
      if (updated.length > 0) {
        setCurrentRunId(updated[0].id);
        setCurrentRun(updated[0]);
      } else {
        setCurrentRunId(null);
        setCurrentRun(null);
        setContacts([]);
        setErrors([]);
        setDuplicates([]);
        setChartData(null);
      }
    }
  };

  const retryRun = (runId) => {
    setCurrentRunId(runId);
    setIsProcessing(true);
    setProgress({ status: 'processing', percentage: 0, message: 'Restarting extraction...' });
    pollRef.current = setInterval(() => pollProgress(runId), 2000);
  };

  const pollProgress = useCallback(async (runId) => {
    try {
      const { data } = await api.get(`/progress/${runId}`);
      setProgress(data);
      if (['completed', 'failed', 'stale', 'paused', 'cancelled'].includes(data.status)) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setIsProcessing(false);
        if (data.status === 'completed') {
          toast.success('Extraction complete!');
        } else if (data.status === 'paused') {
          toast.info('Extraction paused');
        } else if (data.status === 'cancelled') {
          toast.info('Extraction cancelled');
        } else if (data.status === 'failed') {
          toast.error('Processing failed: ' + (data.message || 'Unknown error'));
        }
        await fetchRunData(runId);
        await fetchRuns();
        if (data.status === 'completed' || data.status === 'cancelled') {
          setProgress(null);
        }
      }
    } catch { /* silent */ }
  }, [fetchRunData, fetchRuns]);

  const handleExtract = async () => {
    if (files.length === 0) {
      toast.error('Please select files to upload');
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      files.forEach(f => formData.append('files', f));
      const { data: uploadData } = await api.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const runId = uploadData.run_id;
      setCurrentRunId(runId);
      setFiles([]);
      if (uploadData.rejected_count) {
        toast.warning(`${uploadData.total_files} PDF(s) uploaded. ${uploadData.rejected_count} rejected (limit: ${uploadData.max_pdfs}).`);
      } else {
        toast.success(`${uploadData.total_files} PDF(s) uploaded`);
      }

      setIsUploading(false);
      setIsProcessing(true);
      setProgress({ status: 'processing', percentage: 0, message: 'Starting extraction...' });

      await api.post(`/extract/${runId}`);

      pollRef.current = setInterval(() => pollProgress(runId), 2000);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Upload failed');
      setIsUploading(false);
      setIsProcessing(false);
    }
  };

  const handlePause = async () => {
    if (!currentRunId) return;
    try {
      await api.post(`/runs/${currentRunId}/pause`);
      toast.info('Pausing after current file...');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to pause');
    }
  };

  const handleResume = async () => {
    if (!currentRunId) return;
    try {
      setIsProcessing(true);
      setProgress(p => ({ ...p, status: 'processing', message: 'Resuming...' }));
      await api.post(`/extract/${currentRunId}`);
      pollRef.current = setInterval(() => pollProgress(currentRunId), 2000);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to resume');
      setIsProcessing(false);
    }
  };

  const handleCancel = async () => {
    if (!currentRunId) return;
    try {
      await api.post(`/runs/${currentRunId}/cancel`);
      toast.info('Cancelling extraction...');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to cancel');
    }
  };

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  return (
    <div className="min-h-screen bg-[#0A0F1C]" data-testid="dashboard-page">
      <Header />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Stats */}
        <StatsCards stats={currentRun?.stats} />

        {/* Upload + Extract */}
        <div className="space-y-4">
          <UploadZone files={files} setFiles={setFiles} />

          {/* Progress bar + controls */}
          {progress && (progress.status === 'processing' || progress.status === 'paused' || progress.status === 'pausing' || progress.status === 'cancelling') && (
            <div className="bg-[#111827] border border-slate-800 rounded-sm p-4" data-testid="progress-container">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-300">{progress.message || 'Processing...'}</span>
                <span className="text-sm font-mono text-amber-400">{progress.percentage || 0}%</span>
              </div>
              <div className="bg-slate-800 rounded-full h-1.5 overflow-hidden w-full">
                <div
                  className={`h-full transition-all duration-300 ease-out ${progress.status === 'paused' ? 'bg-sky-400' : 'bg-amber-500'}`}
                  style={{ width: `${progress.percentage || 0}%`, boxShadow: progress.status === 'paused' ? '0 0 8px rgba(14,165,233,0.5)' : '0 0 8px rgba(245,158,11,0.5)' }}
                />
              </div>
              {progress.current_file && progress.status === 'processing' && (
                <p className="text-xs text-slate-500 mt-2 font-mono">{progress.current_file}</p>
              )}
              {/* Pause / Resume / Cancel buttons */}
              <div className="flex items-center gap-2 mt-3">
                {(progress.status === 'processing' || progress.status === 'pausing') && (
                  <button
                    onClick={handlePause}
                    disabled={progress.status === 'pausing'}
                    className="bg-transparent border border-sky-500/30 text-sky-400 hover:bg-sky-500 hover:text-white rounded-sm px-4 py-1.5 text-sm font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50"
                    data-testid="pause-extraction-button"
                  >
                    <Pause className="h-3.5 w-3.5" />
                    {progress.status === 'pausing' ? 'Pausing...' : 'Pause'}
                  </button>
                )}
                {progress.status === 'paused' && (
                  <button
                    onClick={handleResume}
                    className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500 hover:text-white rounded-sm px-4 py-1.5 text-sm font-medium transition-colors inline-flex items-center gap-2"
                    data-testid="resume-extraction-button"
                  >
                    <Play className="h-3.5 w-3.5" /> Resume
                  </button>
                )}
                {['processing', 'pausing', 'paused'].includes(progress.status) && (
                  <button
                    onClick={handleCancel}
                    disabled={progress.status === 'cancelling'}
                    className="bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white rounded-sm px-4 py-1.5 text-sm font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50"
                    data-testid="cancel-extraction-button"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Cancel
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Extract button */}
          {files.length > 0 && !isProcessing && (
            <button
              onClick={handleExtract}
              disabled={isUploading}
              className="bg-sky-500 hover:bg-sky-600 text-white rounded-sm px-6 py-2.5 font-medium transition-colors inline-flex items-center gap-2 disabled:opacity-50"
              data-testid="extract-contacts-button"
            >
              {isUploading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Uploading...</>
              ) : (
                <><Zap className="h-4 w-4" /> Extract Contacts</>
              )}
            </button>
          )}
        </div>

        {/* Data Visualization */}
        <DataViz chartData={chartData} />

        {/* Results Tabs */}
        <Tabs defaultValue="results" className="w-full">
          <TabsList className="bg-[#111827] border border-slate-800 p-1 h-auto rounded-sm flex-wrap">
            <TabsTrigger
              value="results"
              className="text-sm data-[state=active]:bg-sky-500/10 data-[state=active]:text-sky-400 data-[state=active]:shadow-none text-slate-400 rounded-sm px-4 py-1.5"
              data-testid="tab-results"
            >
              Results {contacts.length > 0 && `(${contacts.length})`}
            </TabsTrigger>
            <TabsTrigger
              value="duplicates"
              className="text-sm data-[state=active]:bg-purple-500/10 data-[state=active]:text-purple-400 data-[state=active]:shadow-none text-slate-400 rounded-sm px-4 py-1.5"
              data-testid="tab-duplicates"
            >
              Duplicates {duplicates.length > 0 && `(${duplicates.length})`}
            </TabsTrigger>
            <TabsTrigger
              value="issues"
              className="text-sm data-[state=active]:bg-amber-500/10 data-[state=active]:text-amber-400 data-[state=active]:shadow-none text-slate-400 rounded-sm px-4 py-1.5"
              data-testid="tab-issues"
            >
              Processing Issues {errors.length > 0 && `(${errors.length})`}
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="text-sm data-[state=active]:bg-slate-700/50 data-[state=active]:text-slate-200 data-[state=active]:shadow-none text-slate-400 rounded-sm px-4 py-1.5"
              data-testid="tab-history"
            >
              Run History {runs.length > 0 && `(${runs.length})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="results" className="mt-4 animate-fade-in">
            <ContactsTable contacts={contacts} runId={currentRunId} />
          </TabsContent>
          <TabsContent value="duplicates" className="mt-4 animate-fade-in">
            <DuplicatesTable duplicates={duplicates} />
          </TabsContent>
          <TabsContent value="issues" className="mt-4 animate-fade-in">
            <ErrorsTable errors={errors} runId={currentRunId} />
          </TabsContent>
          <TabsContent value="history" className="mt-4 animate-fade-in">
            <RunHistory runs={runs} onSelectRun={selectRun} onDeleteRun={deleteRun} onRetryRun={retryRun} currentRunId={currentRunId} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
