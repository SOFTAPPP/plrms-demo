import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Eye, EyeOff, Lock, Mail, Radio, ShieldCheck, Video } from 'lucide-react';
import { post } from '../lib/api';
import { useApp } from '../lib/app-store';
import { Button } from '../components/ui/core';
import { Input } from '../components/ui/form';
import { LogoMark } from '../components/layout/Logo';
import { LoginHero } from '../components/layout/LoginHero';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useApp((s) => s.load);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ error?: string }>('/auth/login', { email, password });
      if (r.error) {
        setError(r.error);
        return;
      }
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid h-full lg:grid-cols-[1.4fr_1fr]">
      <div className="relative hidden overflow-hidden border-r border-line text-white lg:block">
        <LoginHero />
        <div className="relative flex h-full flex-col p-12">
          <div className="flex items-center gap-3">
            <LogoMark className="h-10 w-10" />
            <div>
              <p className="font-display text-lg font-bold tracking-[0.2em]">STRATA</p>
              <p className="text-xs uppercase tracking-[0.16em] text-white/60">Mine Operations Intelligence</p>
            </div>
          </div>
          <div className="mt-14 max-w-xl">
            <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
              className="font-display text-4xl font-semibold leading-tight tracking-tight [text-shadow:0_2px_24px_rgba(0,0,0,0.6)]">
              Every machine, sensor and camera on your site — <span className="text-accent">in one live view.</span>
            </motion.h1>
            <div className="mt-7 flex flex-wrap gap-2">
              {[
                { icon: Radio, label: 'Live telemetry' },
                { icon: Video, label: 'Camera DVR & 360°' },
                { icon: ShieldCheck, label: 'Fatigue, proximity & overload alerts' },
              ].map((f, i) => (
                <motion.span key={f.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.08 }}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/35 px-3 py-1.5 text-xs font-medium text-white/90 backdrop-blur-md">
                  <f.icon className="h-3.5 w-3.5 text-accent" /> {f.label}
                </motion.span>
              ))}
            </div>
          </div>
          <p className="mt-auto text-xs text-white/50">Demonstration build · all equipment data is simulated locally</p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <motion.form onSubmit={submit} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark className="h-10 w-10" />
            <p className="font-display text-lg font-bold tracking-[0.2em]">STRATA</p>
          </div>
          <h2 className="font-display text-2xl font-semibold">Sign in</h2>
          <p className="mt-1 text-sm text-muted">Use your control-room account.</p>
          <div className="mt-6 flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted">Email</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <Input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className="h-10 pl-9" placeholder="name@company.com" />
              </div>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted">Password</span>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <Input type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-10 pl-9 pr-10" />
                <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-fg">
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
            {error && <p role="alert" className="rounded-lg border border-crit/30 bg-crit/10 px-3 py-2 text-sm text-crit">{error}</p>}
            <Button type="submit" variant="primary" className="mt-2 h-10 justify-center" loading={busy}>
              Sign in <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-6 text-xs text-faint">Demo roles (password <span className="font-mono">Demo@1234</span>): supervisor@strata.demo · operator@strata.demo · viewer@strata.demo</p>
        </motion.form>
      </div>
    </div>
  );
}
