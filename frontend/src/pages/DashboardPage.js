import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, Zap } from 'lucide-react';
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
      const [runResp, contactsResp, errorsResp, dupesResp, chartsResp] = await Promise.all([
        api.get(`/runs/${runId}`),
        api.get(`/runs/${runId}/contacts`),
        api.get(`/runs/${runId}/errors`),
        api.get(`/runs/${runId}/duplicates`),
        api.get(`/runs/${runId}/charts`),
      ]);
      setCurrentRun(runResp.data);
      setContacts(contactsResp.data);
      setErrors(errorsResp.data);
      setDuplicates(dupesResp.data);
      setChartData(chartsResp.data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  useEffect(() => {
    if (currentRunId) fetchRunData(currentRunId);
  }, [currentRunId, fetchRunData]);

  const selectRun = (runId) => {
    setCurrentRunId(runId);
    const run = runs.find(r => r.id === runId);
    if (run) setCurrentRun(run);
  };

  const pollProgress = useCallback(async (runId) => {
    try {
      const { data } = await api.get(`/progress/${runId}`);
      setProgress(data);
      if (data.status === 'completed' || data.status === 'failed') {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setIsProcessing(false);
        if (data.status === 'completed') {
          toast.success('Extraction complete!');
        } else {
          toast.error('Processing failed: ' + (data.message || 'Unknown error'));
        }
        await fetchRunData(runId);
        await fetchRuns();
        setProgress(null);
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
      toast.success(`${uploadData.total_files} PDF(s) uploaded`);

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

          {/* Progress bar */}
          {(isProcessing || isUploading) && progress && (
            <div className="bg-[#111827] border border-slate-800 rounded-sm p-4" data-testid="progress-container">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-300">{progress.message || 'Processing...'}</span>
                <span className="text-sm font-mono text-amber-400">{progress.percentage || 0}%</span>
              </div>
              <div className="bg-slate-800 rounded-full h-1.5 overflow-hidden w-full">
                <div
                  className="bg-amber-500 h-full transition-all duration-300 ease-out"
                  style={{ width: `${progress.percentage || 0}%`, boxShadow: '0 0 8px rgba(245,158,11,0.5)' }}
                />
              </div>
              {progress.current_file && (
                <p className="text-xs text-slate-500 mt-2 font-mono">{progress.current_file}</p>
              )}
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
            <RunHistory runs={runs} onSelectRun={selectRun} currentRunId={currentRunId} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
