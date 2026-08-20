import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Upload, Play, CheckCircle, XCircle, AlertCircle, RefreshCw, Send, HardDriveDownload } from 'lucide-react';

const API_BASE = 'http://localhost:3000/api';

function App() {
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [toast, setToast] = useState(null);
  const [selectedRegion, setSelectedRegion] = useState('');
  const [currentRegion, setCurrentRegion] = useState(null);
  const [currentEmail, setCurrentEmail] = useState(null);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchStatus = async () => {
    try {
      const res = await axios.get(`${API_BASE}/status`);
      if (res.data.rows) setRows(res.data.rows);
      if (res.data.region) setCurrentRegion(res.data.region);
      if (res.data.email) setCurrentEmail(res.data.email);
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpload = async (e) => {
    if (!selectedRegion) {
      showToast('Please select a region before uploading', 'error');
      return;
    }
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;
    setFile(selectedFile);
    setIsUploading(true);
    
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('region', selectedRegion);

    try {
      const res = await axios.post(`${API_BASE}/upload`, formData);
      setRows(res.data.rows);
      if (res.data.region) setCurrentRegion(res.data.region);
      if (res.data.email) setCurrentEmail(res.data.email);
      showToast('CSV uploaded and validated successfully!');
    } catch (err) {
      showToast('Upload failed', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  const handleStartCampaign = async () => {
    if (rows.length === 0) return showToast('Please upload a CSV file first', 'error');
    setIsSending(true);
    try {
      await axios.post(`${API_BASE}/start`);
      showToast('Campaign started successfully! Emails are now being sent.');
    } catch (err) {
      showToast('Failed to start campaign', 'error');
    } finally {
      setIsSending(false);
    }
  };

  const handleDownload = () => {
    if (rows.length === 0) {
      showToast('Please upload a CSV file first', 'error');
      return;
    }
    window.open(`${API_BASE}/download`, '_blank');
  };

  const handleReset = async () => {
    if (!window.confirm('Are you sure you want to reset the system? This will clear all current data.')) return;
    try {
      await axios.post(`${API_BASE}/reset`);
      setRows([]);
      setFile(null);
      setCurrentRegion(null);
      setCurrentEmail(null);
      showToast('System reset successfully', 'success');
    } catch (err) {
      showToast('Failed to reset system', 'error');
    }
  };

  const stats = {
    total: rows.length,
    sent: rows.filter(r => r.status === 'sent').length,
    bounced: rows.filter(r => r.status === 'bounced').length,
    invalid: rows.filter(r => r.status === 'invalid').length,
    pending: rows.filter(r => r.status === 'pending').length,
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-blue-500/20 relative">
      
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-full shadow-lg border text-sm font-semibold z-50 flex items-center gap-2 transition-all duration-300 ${
          toast.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
        }`}>
          {toast.type === 'error' ? <AlertCircle className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
          {toast.message}
        </div>
      )}

      <div className="max-w-6xl mx-auto p-8">
        
        {/* Header */}
        <header className="flex items-center justify-between mb-12 border-b border-slate-200 pb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
              <Send className="text-blue-600" /> Ship Outreach System
            </h1>
            <p className="text-slate-500 mt-1 font-medium">Automated Stage 1 Email Delivery & Tracking</p>
            {currentRegion && (
              <p className="text-blue-600 mt-1 font-semibold text-sm bg-blue-50 inline-block px-3 py-1 rounded-full border border-blue-100">
                Active Region: {currentRegion.toUpperCase()} {currentEmail ? `(${currentEmail})` : ''}
              </p>
            )}
          </div>
          
          <div className="flex gap-4">
            <select
              value={selectedRegion}
              onChange={(e) => setSelectedRegion(e.target.value)}
              disabled={isUploading || isSending || (rows.length > 0)}
              className="bg-white border border-slate-200 text-slate-700 px-4 py-2.5 rounded-xl outline-none focus:border-blue-500 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="" disabled>Select Region</option>
              <option value="asia">Asia</option>
              <option value="europe">Europe</option>
              <option value="singapore">Singapore</option>
              <option value="africa">Africa</option>
            </select>
            
            <button 
              onClick={() => {
                if (!selectedRegion) {
                  showToast('Please select a region before uploading', 'error');
                } else {
                  document.getElementById('file-upload').click();
                }
              }}
              disabled={isUploading || isSending}
              title="Upload your ship_emails.csv file"
              className="bg-white hover:bg-slate-50 text-slate-700 px-5 py-2.5 rounded-xl border border-slate-200 flex items-center gap-2 transition-all shadow-sm font-medium"
            >
              {isUploading ? <RefreshCw className="animate-spin w-5 h-5 text-blue-500" /> : <Upload className="w-5 h-5 text-blue-500" />}
              {isUploading ? 'Uploading...' : 'Upload CSV'}
            </button>
            <input id="file-upload" type="file" accept=".csv" className="hidden" onChange={handleUpload} />

            <button
              onClick={handleReset}
              disabled={isUploading || isSending || rows.length === 0}
              title="Reset system and clear all data"
              className="bg-red-50 hover:bg-red-100 text-red-600 px-5 py-2.5 rounded-xl border border-red-200 flex items-center gap-2 transition-all shadow-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className="w-5 h-5" />
              Reset
            </button>
            
            <button 
              onClick={handleStartCampaign}
              disabled={isSending || stats.total === 0 || stats.pending === 0}
              title="Start sending emails to all pending ships"
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-all shadow-md shadow-blue-500/20"
            >
              {isSending ? <RefreshCw className="animate-spin w-5 h-5" /> : <Play className="w-5 h-5" />}
              {isSending ? 'Sending...' : 'Start Campaign'}
            </button>
          </div>
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-5 gap-6 mb-10">
          <StatCard title="Total Rows" value={stats.total} icon={<AlertCircle className="text-slate-500" />} />
          <StatCard title="Pending" value={stats.pending} icon={<RefreshCw className="text-amber-500" />} />
          <StatCard title="Sent" value={stats.sent} icon={<CheckCircle className="text-blue-500" />} />
          <StatCard title="Bounced" value={stats.bounced} icon={<XCircle className="text-red-500" />} />
          <StatCard title="Invalid" value={stats.invalid} icon={<AlertCircle className="text-orange-500" />} />
        </div>

        {/* Data Table */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 bg-slate-50/50">
            <h2 className="text-lg font-semibold text-slate-800">Live Status Feed</h2>
            <button 
              onClick={handleDownload} 
              title="Download the updated CSV sheet"
              className="text-slate-500 hover:text-blue-600 font-medium flex items-center gap-2 text-sm transition-colors"
            >
              <HardDriveDownload className="w-4 h-4" /> Download Sheet
            </button>
          </div>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100/80 text-slate-600 sticky top-0 backdrop-blur-md z-10 shadow-sm shadow-slate-200/50">
                <tr>
                  <th className="px-6 py-4 font-semibold">Ship Code</th>
                  <th className="px-6 py-4 font-semibold">Ship Name</th>
                  <th className="px-6 py-4 font-semibold">Email</th>
                  <th className="px-6 py-4 font-semibold">Already Present</th>
                  <th className="px-6 py-4 font-semibold">Last Sent Time</th>
                  <th className="px-6 py-4 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-6 py-12 text-center text-slate-500">
                      No data loaded. Upload a CSV to begin.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-6 py-4 font-mono text-xs font-medium text-slate-500">{row.ship_code}</td>
                      <td className="px-6 py-4 font-semibold text-slate-800">{row.ship_name}</td>
                      <td className="px-6 py-4 text-slate-600">{row.email}</td>
                      <td className="px-6 py-4 text-slate-600">{row.already_present || 'N/A'}</td>
                      <td className="px-6 py-4 text-slate-600 font-mono text-xs">{row.last_sent_time && row.last_sent_time !== 'N/A' ? new Date(row.last_sent_time).toLocaleString() : 'N/A'}</td>
                      <td className="px-6 py-4">
                        <StatusBadge status={row.status || 'pending'} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon }) {
  return (
    <div className="bg-white border border-slate-200 p-6 rounded-2xl flex items-center justify-between shadow-sm hover:border-slate-300 transition-colors">
      <div>
        <p className="text-slate-500 text-sm font-semibold mb-1 uppercase tracking-wide">{title}</p>
        <p className="text-3xl font-bold text-slate-800">{value}</p>
      </div>
      <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
        {icon}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    sent: 'bg-blue-50 text-blue-700 border-blue-200',
    bounced: 'bg-red-50 text-red-700 border-red-200',
    invalid: 'bg-orange-50 text-orange-700 border-orange-200',
    failed: 'bg-red-50 text-red-900 border-red-300 font-bold',
    skipped_24h: 'bg-slate-100 text-slate-700 border-slate-300',
    delivered: 'bg-emerald-50 text-emerald-700 border-emerald-200'
  };
  
  const style = styles[status] || styles.pending;

  return (
    <span className={`px-3 py-1.5 text-xs font-bold rounded-full border uppercase tracking-wider ${style}`}>
      {status}
    </span>
  );
}

export default App;
