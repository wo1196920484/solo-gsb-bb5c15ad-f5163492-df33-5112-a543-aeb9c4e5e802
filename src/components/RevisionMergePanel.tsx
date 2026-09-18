import { useRef } from 'react';
import type { Subtitle } from '../types';
import type { MergeResult } from '../merge';
import { formatTimestamp } from '../srt';

interface RevisionMergePanelProps {
  current: Subtitle[];
  revision: Subtitle[] | null;
  revisionName: string;
  result: MergeResult | null;
  onImportRevision: (file: File) => void;
  onClearRevision: () => void;
  onApply: () => void;
  onJump: (id: string, sec: number) => void;
}

function scoreClass(score: number): string {
  if (score >= 0.75) return 'score-high';
  if (score >= 0.6) return 'score-mid';
  return 'score-low';
}

function SubLine({ sub, variant }: { sub: Subtitle; variant: 'current' | 'revision' }) {
  return (
    <div className={`merge-text merge-text-${variant}`}>
      <span className="merge-text-label">{variant === 'current' ? '当前' : '修订'}</span>
      <span className="merge-text-body">{sub.text}</span>
    </div>
  );
}

export default function RevisionMergePanel({
  current,
  revision,
  revisionName,
  result,
  onImportRevision,
  onClearRevision,
  onApply,
  onJump,
}: RevisionMergePanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const disabled = current.length === 0;

  return (
    <aside className="merge-panel">
      <div className="merge-header">
        <span className="merge-title">修订稿合并</span>
        <div className="merge-actions">
          <button
            className="btn mini"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
            title={disabled ? '请先导入当前字幕' : '导入一份 SRT 作为修订稿，不影响当前时间轴'}
          >
            📥 导入修订稿
          </button>
          {revision && (
            <button className="btn mini" onClick={onClearRevision} title="移除修订稿">
              ✕
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".srt,text/plain"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onImportRevision(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {revisionName && <div className="merge-file" title={revisionName}>📝 {revisionName}</div>}

      <div className="merge-body">
        {disabled && <div className="merge-empty">尚未导入当前字幕</div>}

        {!disabled && !revision && (
          <div className="merge-empty">
            导入一份 SRT 修订稿后，将按文本相似度（60%）与时间区间重合度（40%）
            自动对齐，预览匹配结果。修订稿不会替换当前时间轴。
          </div>
        )}

        {revision && result && (
          <>
            {revision.length === 0 && <div className="merge-empty">修订稿未解析出有效字幕</div>}

            {result.pairs.length === 0 && revision.length > 0 && (
              <div className="merge-empty">没有达到 0.45 阈值的匹配候选</div>
            )}

            {result.pairs.map((p) => {
              const cur = current[p.currentIndex];
              const rev = revision[p.revisionIndex];
              return (
                <button
                  key={`${p.currentIndex}-${p.revisionIndex}`}
                  className="merge-pair"
                  onClick={() => onJump(cur.id, Math.max(0, cur.start) / 1000)}
                  title="点击定位到该条当前字幕"
                >
                  <div className="merge-pair-head">
                    <span className="merge-pair-idx">
                      当前 #{cur.index} ↔ 修订 #{rev.index}
                    </span>
                    <span className={`merge-score ${scoreClass(p.score)}`}>
                      {p.score.toFixed(3)}
                    </span>
                  </div>
                  <SubLine sub={cur} variant="current" />
                  <SubLine sub={rev} variant="revision" />
                  <div className="merge-sub-scores">
                    <span>{formatTimestamp(cur.start)} → {formatTimestamp(cur.end)}</span>
                    <span className="merge-detail">
                      文本 {p.textScore.toFixed(2)} · 时间 {p.timeScore.toFixed(2)}
                    </span>
                  </div>
                </button>
              );
            })}

            {result.unmatchedCurrent.length > 0 && (
              <div className="merge-unmatched">
                <div className="merge-unmatched-title">
                  未匹配的当前字幕（{result.unmatchedCurrent.length}）
                </div>
                {result.unmatchedCurrent.map((idx) => {
                  const s = current[idx];
                  return (
                    <button
                      key={s.id}
                      className="merge-unmatched-row"
                      onClick={() => onJump(s.id, Math.max(0, s.start) / 1000)}
                      title={s.text}
                    >
                      #{s.index} {s.text}
                    </button>
                  );
                })}
              </div>
            )}

            {result.unmatchedRevision.length > 0 && (
              <div className="merge-unmatched">
                <div className="merge-unmatched-title">
                  未匹配的修订稿（{result.unmatchedRevision.length}）
                </div>
                {result.unmatchedRevision.map((idx) => {
                  const s = revision[idx];
                  return (
                    <div key={idx} className="merge-unmatched-row revision" title={s.text}>
                      #{s.index} {s.text}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {revision && result && (
        <div className="merge-footer">
          <button
            className="btn success"
            disabled={result.pairs.length === 0}
            onClick={onApply}
            title="仅把已匹配条目的修订文本写入当前字幕，保留 id、序号与时间"
          >
            ✅ 应用 {result.pairs.length} 条匹配（整批一次撤销）
          </button>
        </div>
      )}
    </aside>
  );
}
