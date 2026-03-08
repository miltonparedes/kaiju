'use client';

import { Bot, CheckCircle2, ChevronDown, ChevronRight, MessageSquare, User } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Badge } from '@/components/ui/badge.js';
import { Button } from '@/components/ui/button.js';
import { Textarea } from '@/components/ui/textarea.js';
import { cn } from '@/lib/utils.js';

import type { DashboardFinding } from '../routes/$provider/$org/$repo/$pr/types.js';
import { getSeverityStyle } from './findingsCommentsUtils.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FindingAnnotationProps {
  finding: DashboardFinding;
  defaultExpanded?: boolean;
}

// ─── Reviewer Icon ────────────────────────────────────────────────────────────

function ReviewerIcon({ reviewer }: { reviewer: string }) {
  const isAgent = reviewer.includes('agent') || reviewer.includes('claude') || reviewer === '';
  return isAgent ? (
    <Bot className="size-3.5 text-primary" />
  ) : (
    <User className="size-3.5 text-muted-foreground" />
  );
}

// ─── Code Suggestion Block ────────────────────────────────────────────────────

function CodeSuggestionBlock({ suggestion }: { suggestion: string }) {
  return (
    <div className="rounded-md border border-border bg-background/80">
      <div className="border-b border-border px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Suggested fix
        </span>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code className="text-foreground/90">{suggestion}</code>
      </pre>
    </div>
  );
}

// ─── Finding Annotation (main export) ─────────────────────────────────────────

export function FindingAnnotation({ finding, defaultExpanded = false }: FindingAnnotationProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [agentPrompt, setAgentPrompt] = useState('');
  const style = getSeverityStyle(finding.severity);

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  return (
    <div
      data-finding-id={finding.id}
      className={cn('my-1 rounded-md border', style.bg, 'border-current/20', 'text-foreground')}
    >
      {/* Collapsed header — always visible */}
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className={cn('text-sm', style.text)}>
          {getSeverityStyle(finding.severity).label}
        </span>
        <Badge
          variant="outline"
          className={cn('ml-auto px-1.5 py-0 text-[10px]', style.bg, style.text)}
        >
          {style.label}
        </Badge>
      </button>

      {/* Expanded details */}
      {expanded ? (
        <div className="space-y-3 border-t border-border/30 px-3 pb-3 pt-2">
          {/* Reviewer identity */}
          <div className="flex items-center gap-1.5">
            <ReviewerIcon reviewer={finding.reviewer} />
            <span className="text-xs text-muted-foreground">
              {finding.reviewer || 'kaiju-agent'}
            </span>
          </div>

          {/* Main message */}
          <p className="text-sm leading-relaxed text-foreground/90">{finding.message}</p>

          {/* Root Cause & Impact section */}
          {finding.rootCause || finding.impact ? (
            <div className="rounded-md border border-border/40 bg-background/50 p-3">
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Root Cause &amp; Impact
              </h4>
              {finding.rootCause ? (
                <p className="text-sm leading-relaxed text-foreground/80">{finding.rootCause}</p>
              ) : null}
              {finding.impact ? (
                <p className="mt-1 text-sm leading-relaxed text-foreground/80">{finding.impact}</p>
              ) : null}
            </div>
          ) : null}

          {/* Code suggestion */}
          {finding.codeSuggestion ? (
            <CodeSuggestionBlock suggestion={finding.codeSuggestion} />
          ) : finding.suggestion ? (
            <CodeSuggestionBlock suggestion={finding.suggestion} />
          ) : null}

          {/* Agent prompt input */}
          <div>
            <Textarea
              placeholder="Prompt for agent…"
              value={agentPrompt}
              onChange={(e) => setAgentPrompt(e.target.value)}
              className="h-16 resize-none border-border bg-background/80 text-xs"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                // TODO: wire up agent prompt action
              }}
            >
              <MessageSquare className="mr-1 size-3" />
              Ask Agent
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                // TODO: wire up mark resolved action
              }}
            >
              <CheckCircle2 className="mr-1 size-3" />
              Mark resolved
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
