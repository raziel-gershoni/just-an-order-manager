'use client';

import { useEffect, useRef, useState } from 'react';
import { BarChart3, Lock } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useGroup } from '@/hooks/useGroup';
import { useT } from '@/hooks/useLang';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ControlCenterTabs } from '@/components/ui/ControlCenterTabs';
import { IncomeReportView } from '@/components/reports/IncomeReportView';
import type { IncomeReport } from '@/lib/income-report-types';

/**
 * The income report: a calendar year's מחזור, money received and money owed,
 * month by month, with units per bread and totals per customer — and the same
 * figures as a spreadsheet for the accountant.
 *
 * Read live from the ledger, so it always agrees with the balances shown
 * everywhere else. See docs/superpowers/specs/2026-10-13-income-report-design.md.
 */
export default function ReportsPage() {
  const { apiFetch } = useApi();
  const { activeGroupId, activeGroupRole } = useGroup();
  const t = useT();
  const toast = useToast();
  const isAdmin = activeGroupRole === 'owner' || activeGroupRole === 'manager';

  // null = whatever the server calls the current year (its Israel calendar,
  // not this phone's).
  const [year, setYear] = useState<number | null>(null);
  const [report, setReport] = useState<IncomeReport | null>(null);
  const [loading, setLoading] = useState(true);
  // The tab is hidden for other roles, but the URL is still typeable and the
  // endpoint 403s. An empty report would be a lie about why.
  const [denied, setDenied] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  // Stepping through years quickly fires overlapping requests; only the latest
  // may land, or 2025's figures could arrive under a 2026 heading.
  const latest = useRef(0);

  function load(y: number | null) {
    const id = ++latest.current;
    setLoading(true);
    setLoadFailed(false);
    apiFetch<IncomeReport>(`/reports/income${y ? `?year=${y}` : ''}`)
      .then((r) => {
        if (id === latest.current) setReport(r);
      })
      .catch((e: Error & { status?: number }) => {
        if (id !== latest.current) return;
        if (e.status === 403) setDenied(true);
        else {
          console.warn('[reports] load failed', e);
          // Drop the previous year's figures too: left on screen, they would
          // sit under the heading of the year that failed to load.
          setReport(null);
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (id === latest.current) setLoading(false);
      });
  }

  useEffect(() => {
    if (!activeGroupId || !isAdmin) return;
    load(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupId, isAdmin, year]);

  async function download() {
    if (!report) return;
    setDownloading(true);
    try {
      const { url, fileName } = await apiFetch<{ url: string; fileName: string }>(
        `/reports/income/token?year=${report.year}`
      );
      const absolute = `${window.location.origin}${url}`;
      // Inside Telegram an in-page download gets "opened", not saved; the native
      // dialog is the only way to hand over a file.
      const tg = (
        window as unknown as {
          Telegram?: { WebApp?: { downloadFile?: (p: { url: string; file_name: string }) => void } };
        }
      ).Telegram?.WebApp;
      if (typeof tg?.downloadFile === 'function') {
        tg.downloadFile({ url: absolute, file_name: fileName });
        return;
      }
      // A browser follows the link; the file route answers with
      // Content-Disposition: attachment, so the page stays where it is.
      const a = document.createElement('a');
      a.href = absolute;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      toast.error(t('reports.download_failed'));
    } finally {
      setDownloading(false);
    }
  }

  // The layout renders nothing until /auth/me has answered, so a missing role
  // here is final — no membership, or an auth that failed — not "still loading".
  if (!isAdmin || denied) {
    return (
      <>
        <ControlCenterTabs />
        <EmptyState icon={Lock} title={t('reports.denied')} />
      </>
    );
  }

  if (!report) {
    if (loadFailed) {
      return (
        <>
          <ControlCenterTabs />
          <EmptyState
            icon={BarChart3}
            title={t('reports.load_failed')}
            action={
              <Button size="sm" variant="outline" onClick={() => load(year)}>
                {t('reports.retry')}
              </Button>
            }
          />
        </>
      );
    }
    return (
      <>
        <ControlCenterTabs />
        <div className="space-y-4 p-5">
          <div className="h-10 w-40 rounded-lg bg-muted animate-pulse" />
          <div className="h-36 rounded-xl bg-muted animate-pulse" />
          <div className="h-64 rounded-xl bg-muted animate-pulse" />
        </div>
      </>
    );
  }

  return (
    <>
      <ControlCenterTabs />
      <IncomeReportView
        // A fresh report starts with every month folded and the customer list short.
        key={`${report.year}:${report.generatedAt}`}
        report={report}
        shownYear={year ?? report.year}
        loading={loading}
        downloading={downloading}
        onYear={setYear}
        onDownload={download}
      />
    </>
  );
}
