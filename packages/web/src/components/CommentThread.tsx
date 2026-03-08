'use client';

import { ChevronDown, ChevronRight, MessageCircle } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Badge } from '@/components/ui/badge.js';
import { cn } from '@/lib/utils.js';

import type { DashboardComment } from '../routes/$provider/$org/$repo/$pr/types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CommentThreadProps {
  threadId: string;
  comments: DashboardComment[];
  defaultExpanded?: boolean;
}

// ─── Timestamp formatting ─────────────────────────────────────────────────────

function formatTimestamp(ts: string | null): string {
  if (!ts) {
    return '';
  }
  try {
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

// ─── Single Comment ───────────────────────────────────────────────────────────

function SingleComment({ comment }: { comment: DashboardComment }) {
  return (
    <div className="border-t border-border/30 px-3 py-2 first:border-t-0">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-foreground/80">
          {comment.author ?? 'unknown'}
        </span>
        {comment.timestamp ? (
          <span className="text-[10px] text-muted-foreground">
            {formatTimestamp(comment.timestamp)}
          </span>
        ) : null}
        <Badge variant="outline" className="ml-auto px-1 py-0 text-[9px] text-muted-foreground">
          {comment.source}
        </Badge>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
        {comment.body}
      </p>
    </div>
  );
}

// ─── CommentThread (main export) ──────────────────────────────────────────────

export function CommentThread({
  threadId: _threadId,
  comments,
  defaultExpanded = false,
}: CommentThreadProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const firstAuthor = comments[0]?.author ?? 'unknown';
  const replyCount = comments.length - 1;

  return (
    <div className={cn('my-1 rounded-md border', 'border-border bg-card/80', 'text-foreground')}>
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
        <MessageCircle className="size-3.5 shrink-0 text-blue-400" />
        <span className="text-xs text-foreground/80">{firstAuthor}</span>
        {replyCount > 0 ? (
          <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">
            +{replyCount} {replyCount === 1 ? 'reply' : 'replies'}
          </Badge>
        ) : null}
        {!expanded ? (
          <span className="ml-1 min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {comments[0]?.body.slice(0, 80)}
            {(comments[0]?.body.length ?? 0) > 80 ? '…' : ''}
          </span>
        ) : null}
      </button>

      {/* Expanded: full thread */}
      {expanded ? (
        <div className="border-t border-border/50">
          {comments.map((c) => (
            <SingleComment key={c.id} comment={c} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
