'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { ArticleDetail } from '@/lib/article-types';
import { Badge, Card, cn } from '@/components/ui';

type Check = { id: string; label: string; passed: boolean; detail: string; weight?: number };

function ScoreRing({ label, score, target }: { label: string; score: number | null; target?: number }) {
  const color = score === null ? 'text-gray-300' : score >= (target ?? 80) ? 'text-emerald-500' : score >= 60 ? 'text-amber-500' : 'text-red-500';
  return (
    <div className="flex flex-col items-center rounded-lg border border-gray-200 bg-white p-4">
      <div className={cn('text-3xl font-bold', color)}>{score ?? '–'}</div>
      <div className="mt-1 text-xs text-gray-500">{label}</div>
    </div>
  );
}

export function OverviewTab({ task }: { task: ArticleDetail }) {
  const internal = task.seoReports.find((r) => r.source === 'INTERNAL');
  const rankmath = task.seoReports.find((r) => r.source === 'RANKMATH');
  const checks = internal ? (JSON.parse(internal.checks) as Check[]) : [];
  const rmChecks = rankmath ? (JSON.parse(rankmath.checks) as Check[]) : [];
  const research = task.stages.find((s) => s.key === 'RESEARCH')?.output;
  const [showResearch, setShowResearch] = useState(false);
  const tags = JSON.parse(task.tags || '[]') as string[];

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Card title="Article preview" description={task.contentHtml ? 'Assembled article as it is sent to WordPress' : task.bodyHtml ? 'Article body (not assembled yet)' : undefined}>
          {task.contentHtml || task.bodyHtml ? (
            <div className="article-preview max-h-[70vh] overflow-y-auto" dangerouslySetInnerHTML={{ __html: task.contentHtml || task.bodyHtml || '' }} />
          ) : (
            <p className="text-sm text-gray-500">The article has not been written yet.</p>
          )}
        </Card>
        {research && (
          <Card title="Research" actions={<button className="text-xs text-brand-600" onClick={() => setShowResearch(!showResearch)}>{showResearch ? 'Hide' : 'Show'}</button>}>
            {showResearch ? <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs text-gray-700">{research}</pre> : <p className="text-sm text-gray-500">{research.slice(0, 240)}…</p>}
          </Card>
        )}
      </div>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <ScoreRing label="SEO Readiness" score={task.seoScore} />
          <ScoreRing label="Rank Math" score={task.rankMathScore} />
        </div>
        <Card title="SEO fields">
          <dl className="space-y-2 text-sm">
            <Row label="SEO title" value={task.seoTitle} hint={task.seoTitle ? `${task.seoTitle.length} chars` : undefined} />
            <Row label="Meta description" value={task.metaDescription} hint={task.metaDescription ? `${task.metaDescription.length} chars` : undefined} />
            <Row label="Slug" value={task.slug} />
            <Row label="Focus keyword" value={task.focusKeyword ?? task.keyword} />
            <Row label="Category" value={task.categoryName} />
            <div>
              <dt className="text-xs text-gray-500">Tags</dt>
              <dd className="mt-1 flex flex-wrap gap-1">{tags.length ? tags.map((t) => <Badge key={t}>{t}</Badge>) : <span className="text-gray-400">—</span>}</dd>
            </div>
          </dl>
        </Card>
        <Card title="Metrics">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <Row label="Words" value={task.wordCount?.toString()} />
            <Row label="Keyword uses" value={task.keywordCount?.toString()} />
            <Row label="Density" value={task.keywordDensity !== null ? `${task.keywordDensity}%` : null} />
            <Row label="H2 / H3" value={task.h2Count !== null ? `${task.h2Count} / ${task.h3Count}` : null} />
          </dl>
        </Card>
        {task.wpPostId && (
          <Card title="WordPress">
            <dl className="space-y-2 text-sm">
              <Row label="Post ID" value={String(task.wpPostId)} />
              <Row label="Draft saved" value={task.wpDraftSavedAt ? new Date(task.wpDraftSavedAt).toLocaleString() : null} />
              {task.workflowKeyword?.publishAt && <Row label="Scheduled for" value={new Date(task.workflowKeyword.publishAt).toLocaleString()} />}
              {task.workflowKeyword?.publishedUrl && <Row label="Published" value={task.workflowKeyword.publishedUrl} />}
            </dl>
          </Card>
        )}
        {checks.length > 0 && <ChecksCard title={`SEO Readiness checks (${internal!.score})`} checks={checks} />}
        {rmChecks.length > 0 && <ChecksCard title={`Rank Math tests (${rankmath!.score})`} checks={rmChecks} />}
      </div>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string | null | undefined; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">
        {label} {hint && <span className="text-gray-400">· {hint}</span>}
      </dt>
      <dd className="break-words text-gray-800">{value || <span className="text-gray-400">—</span>}</dd>
    </div>
  );
}

function ChecksCard({ title, checks }: { title: string; checks: Check[] }) {
  return (
    <Card title={title}>
      <ul className="space-y-1.5 text-sm">
        {checks.map((c) => (
          <li key={c.id} className="flex gap-2">
            {c.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />}
            <span>
              {c.label}
              {c.detail && <span className="block text-xs text-gray-500">{c.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
