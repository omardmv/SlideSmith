import { useState } from 'react';
import { X, Loader2, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import type { Slideshow } from '../types';
import { Button } from './Button';
import { renderSlideshow } from '../lib/render';
import { saveSlideshow } from '../lib/api';

interface BulkSaveModalProps {
  slideshows: Slideshow[];
  onClose: () => void;
  onDone: () => void;
}

interface ItemState {
  status: 'pending' | 'saving' | 'ok' | 'error';
  path?: string;
  error?: string;
}

export function BulkSaveModal({ slideshows, onClose, onDone }: BulkSaveModalProps) {
  const [items, setItems] = useState<ItemState[]>(
    slideshows.map(() => ({ status: 'pending' as const }))
  );
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  // Sequential save — running these concurrently would fire N big base64 PNG
  // POSTs at the local server at the same time, which is rough on memory and
  // buys us nothing (disk is the bottleneck). One at a time keeps it smooth.
  const run = async () => {
    setRunning(true);
    for (let i = 0; i < slideshows.length; i++) {
      const show = slideshows[i];
      setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: 'saving' } : it)));
      try {
        const slides = await renderSlideshow(show);
        const { path } = await saveSlideshow(show.id, { slides, caption: show.caption, hashtags: show.hashtags });
        setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: 'ok', path } : it)));
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: 'error', error } : it)));
      }
    }
    setRunning(false);
    setFinished(true);
  };

  const doneCount = items.filter((it) => it.status === 'ok').length;
  const errorCount = items.filter((it) => it.status === 'error').length;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={running ? undefined : onClose}>
      <div className="bg-card border border-line rounded-2xl w-full max-w-md max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-[15px] font-semibold text-ink">
            Save {slideshows.length} slideshow{slideshows.length === 1 ? '' : 's'} to disk
          </h2>
          {!running && <button onClick={onClose} className="text-ink-5 hover:text-ink"><X size={18} /></button>}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {slideshows.map((show, i) => {
            const state = items[i];
            return (
              <div key={show.id} className="flex items-start gap-2.5 px-3 py-2 rounded-lg border border-line">
                <div className="w-5 h-5 shrink-0 flex items-center justify-center mt-0.5">
                  {state.status === 'saving' && <Loader2 size={14} className="animate-spin text-ink-5" />}
                  {state.status === 'ok' && <CheckCircle2 size={14} className="text-emerald-600" />}
                  {state.status === 'error' && <AlertCircle size={14} className="text-red-600" />}
                  {state.status === 'pending' && <div className="w-1.5 h-1.5 rounded-full bg-line-2" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-ink font-medium truncate">{show.hook}</p>
                  {state.path && (
                    <p className="text-[11px] text-ink-5 truncate font-mono" title={state.path}>{state.path}</p>
                  )}
                  {state.error && (
                    <p className="text-[11px] text-red-600">{state.error}</p>
                  )}
                </div>
              </div>
            );
          })}

          {finished && errorCount > 0 && (
            <p className="text-[12px] text-red-600 pt-2">{errorCount} failed — see errors above.</p>
          )}
        </div>

        <div className="px-5 py-4 border-t border-line flex justify-end gap-2">
          {finished ? (
            <Button variant="primary" onClick={onDone}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose} disabled={running}>Cancel</Button>
              <Button
                variant="primary"
                icon={running ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                onClick={run}
                disabled={running}
              >
                {running ? `Saving ${doneCount}/${slideshows.length}…` : `Save ${slideshows.length} to disk`}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
