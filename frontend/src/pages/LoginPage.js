import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LogIn, UserPlus, Loader2 } from 'lucide-react';

function formatApiError(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map(e => e?.msg || JSON.stringify(e)).filter(Boolean).join(" ");
  if (detail?.msg) return detail.msg;
  return String(detail);
}

export default function LoginPage() {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isRegister) {
        await register(email, password, name);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" data-testid="login-page">
      {/* Left - Background */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1773666330599-bf7afde8fbf7?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NzB8MHwxfHNlYXJjaHwyfHxkYXJrJTIwYXJjaGl0ZWN0dXJlJTIwYmx1ZXByaW50JTIwZ2VvbWV0cmljJTIwYWJzdHJhY3R8ZW58MHx8fHwxNzc2MzgwMTQ3fDA&ixlib=rb-4.1.0&q=85"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-[#0A0F1C]/80" />
        <div className="relative z-10 flex flex-col justify-center px-16">
          <h1 className="text-4xl sm:text-5xl font-semibold text-white tracking-tight leading-tight">
            TrueFlow<br />
            <span className="text-sky-400">Business Automations</span>
          </h1>
          <p className="mt-6 text-slate-400 text-lg max-w-md">
            Extract contacts from construction bid documents with AI-powered precision. Upload PDFs, get structured data.
          </p>
        </div>
      </div>

      {/* Right - Form */}
      <div className="flex-1 flex items-center justify-center bg-[#0A0F1C] px-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-10">
            <h1 className="text-3xl font-semibold text-white tracking-tight">
              TrueFlow <span className="text-sky-400">Business Automations</span>
            </h1>
          </div>

          <h2 className="text-base md:text-lg font-semibold text-slate-200 mb-1">
            {isRegister ? 'Create Account' : 'Sign In'}
          </h2>
          <p className="text-sm text-slate-500 mb-8">
            {isRegister ? 'Set up your extraction portal access' : 'Access your extraction dashboard'}
          </p>

          {error && (
            <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-sm text-red-400 text-sm" data-testid="login-error">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Name</label>
                <Input
                  data-testid="register-name-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="bg-[#111827] border-slate-800 text-slate-200 placeholder:text-slate-600 focus:border-sky-500"
                />
              </div>
            )}
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Email</label>
              <Input
                data-testid="login-email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                required
                className="bg-[#111827] border-slate-800 text-slate-200 placeholder:text-slate-600 focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 uppercase tracking-wider">Password</label>
              <Input
                data-testid="login-password-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
                className="bg-[#111827] border-slate-800 text-slate-200 placeholder:text-slate-600 focus:border-sky-500"
              />
            </div>
            <Button
              data-testid="login-submit-button"
              type="submit"
              disabled={loading}
              className="w-full bg-sky-500 hover:bg-sky-600 text-white rounded-sm h-10 font-medium transition-colors"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isRegister ? (
                <><UserPlus className="h-4 w-4" /> Create Account</>
              ) : (
                <><LogIn className="h-4 w-4" /> Sign In</>
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <button
              data-testid="toggle-auth-mode"
              onClick={() => { setIsRegister(!isRegister); setError(''); }}
              className="text-sm text-slate-500 hover:text-sky-400 transition-colors"
            >
              {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Register"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
