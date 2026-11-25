import { EventBadges } from './verification';
import { isValidElement, memo, useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import type { ReviewStatus } from '../../types';
import { formatDate, labels, plainText, priceInfo, publicationLabels, reviews, sourceNames, type EventRow, type PublicationStatus } from './data';
import type { EventRowEdits } from './event-row-edits';
import { Icon } from './workspace';

const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });

function EventItem({ row, today, open, toggle, selected, select, disabled, pendingEdit, bookmarkPending, confirmPending, review, changePublication, confirm, editor, showSource, saved, toggleSaved, changeInterestScore, selectionEnabled = true }: {
  row: EventRow; today: string; open: boolean; toggle: () => void; selected: boolean;
  select: (checked: boolean) => void; disabled: boolean; review: (status: ReviewStatus) => void;
  confirm: () => void; editor: ReactNode; showSource: boolean; saved: boolean; toggleSaved: () => void;
  changeInterestScore: (score: 1 | 2 | 3 | 4 | 5) => void;
  changePublication: (status: PublicationStatus) => void;
  pendingEdit?: EventRowEdits;
  bookmarkPending?: boolean;
  confirmPending?: boolean;
  selectionEnabled?: boolean;
}) {
  const title = plainText(row.title);
  const assistantPending = !!row.assistant_reviewed_at && !row.assistant_confirmed_at;
  const date = row.event_date ? formatDate(row.event_date) : 'Date unknown';
  const past = !!row.event_date && (row.event_end_date || row.event_date) < today;
  const time = row.event_time?.trim().slice(0, 5);
  const price = priceInfo(row);
  const scorePending = pendingEdit?.interest_score !== undefined;
  const reviewPending = pendingEdit?.review_status !== undefined;
  const publicationPending = pendingEdit?.publication_status !== undefined;
  const interestScore = pendingEdit?.interest_score ?? (row.interest_score || 1);
  const reviewStatus = pendingEdit?.review_status ?? row.review_status;
  const publicationStatus = pendingEdit?.publication_status ?? row.publication_status ?? 'draft';
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => {
    if (!copyStatus) return;
    const timer = window.setTimeout(() => setCopyStatus(''), 3000);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  function toggleTitle(event: MouseEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    if (selection?.rangeCount && !selection.isCollapsed && selection.getRangeAt(0).intersectsNode(event.currentTarget)) return;
    toggle();
  }

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(`${title} (Seeker event #${row.id})`);
      setCopyStatus('Event name and ID copied.');
    } catch {
      setCopyStatus(`Clipboard unavailable. Seeker event #${row.id}.`);
    }
  }

  return (
    <article className={`event-item ${open ? 'event-open' : ''} ${selected ? 'event-selected' : ''}`}>
      <div className={`event-row ${selectionEnabled ? '' : 'event-row-saved'}`}>
        {selectionEnabled && <input type="checkbox" aria-label={`Select ${title}`} checked={selected} disabled={disabled} onChange={event => select(event.target.checked)} />}
        <div className="event-date" aria-label={date} title={date}>
          <span>{row.event_date ? monthFormatter.format(new Date(`${row.event_date}T12:00:00Z`)) : 'Date'}</span>
          <strong>{row.event_date?.slice(8, 10) || '—'}</strong>
        </div>
        <div className="event-main">
          <div className="event-title" onClick={toggleTitle}>
            <strong>{title}</strong>
            <span>
              {row.event_date && row.event_date.slice(0, 4) !== today.slice(0, 4) && <span>{row.event_date.slice(0, 4)}</span>}
              {time && <span title="Event time"><Icon name="clock" size={13} /> {time}</span>}
              {!time && <span className="missing-detail"><Icon name="clock" size={13} /> Time unknown</span>}
              {row.venue && <span title="Venue"><Icon name="pin" size={13} /> {row.venue}</span>}
              {(price.text || price.type === 'free' || price.type === 'paid') && <span title="Price"><Icon name="ticket" size={13} /> {price.text || (price.type === 'free' ? 'Free' : 'Paid')}</span>}
              {price.type === 'unknown' && <span className="missing-detail"><Icon name="ticket" size={13} /> Price unknown</span>}
              {showSource && <span>{sourceNames[row.source_key] ?? row.source_key}</span>}
            </span>
          </div>
          <EventBadges row={{ ...row, publication_status: publicationStatus }} />
          {row.attention_reason && <p className="event-attention-reason">{row.attention_reason}</p>}
          <div className="interest-score-buttons" role="group" aria-label={`Interest score for ${title}`} title={`Interest score: ${interestScore} of 5`}>
            {[1, 2, 3, 4, 5].map(score => <button
              key={score}
              type="button"
              className={`interest-score-button ${interestScore === score ? 'active' : ''}`}
              aria-label={`Set interest score to ${score} for ${title}`}
              aria-pressed={interestScore === score}
              aria-busy={scorePending}
              disabled={disabled || scorePending}
              onClick={() => changeInterestScore(score as 1 | 2 | 3 | 4 | 5)}
            >{score}</button>)}
          </div>
        </div>
        <div className="event-actions">
          <div className="event-review">
            <label className={`review-select publication-select publication-select-${publicationStatus}`}>
              <select aria-label={`Publication status for ${title}`} value={publicationStatus} aria-busy={publicationPending} disabled={disabled || publicationPending} onChange={event => changePublication(event.target.value as PublicationStatus)}>
                <option value="draft">{publicationLabels.draft}</option>
                <option value="live">{publicationLabels.live}</option>
              </select>
              <Icon name="down" size={13} />
            </label>
            <label className={`review-select review-${reviewStatus}`}>
              <select aria-label={`Review status for ${title}`} value={reviewStatus} aria-busy={reviewPending} disabled={disabled || reviewPending} onChange={event => review(event.target.value as ReviewStatus)}>
                {reviews.map(status => <option key={status} value={status}>{labels[status]}</option>)}
              </select>
              <Icon name="down" size={13} />
            </label>
            <small>{assistantPending ? 'Needs your check' : past ? 'Past event' : ''}</small>
          </div>
          <button type="button" className="icon-button save-event-button" aria-label={saved ? `Remove ${title} from saved events` : `Save ${title}`} aria-pressed={saved} aria-busy={bookmarkPending} disabled={disabled || bookmarkPending} title={saved ? 'Remove from saved events' : 'Save event'} onClick={toggleSaved}><Icon name="save" /></button>
          <div className="event-copy-control">
            <button type="button" className="icon-button" aria-label={`Copy event name and ID for ${title}`} title="Copy event name and ID" onClick={() => void copyReference()}><Icon name={copyStatus.startsWith('Event name') ? 'check' : 'copy'} /></button>
            <span className="event-copy-status" role="status">{copyStatus}</span>
          </div>
          <button type="button" className="icon-button event-expand" aria-label={`${open ? 'Hide' : 'Show'} details for ${title}`} aria-expanded={open} aria-controls={open ? `event-details-${row.id}` : undefined} onClick={toggle}><Icon name="down" /></button>
        </div>
      </div>
      {open && (
        <div className="event-details" id={`event-details-${row.id}`}>
          {assistantPending && (
            <div className="assistant-note">
              <div><strong>Assistant review</strong><p>{row.assistant_notes || 'No notes provided.'}</p></div>
              <button className="secondary-button" type="button" disabled={disabled || confirmPending} onClick={confirm}><Icon name="check" size={15} /> Mark as checked</button>
            </div>
          )}
          {editor}
        </div>
      )}
    </article>
  );
}

function sameEditor(previous: ReactNode, next: ReactNode) {
  if (previous === next) return true;
  if (!isValidElement(previous) || !isValidElement(next) || previous.type !== next.type || previous.key !== next.key) return false;
  const previousProps = previous.props as Record<string, unknown>;
  const nextProps = next.props as Record<string, unknown>;
  return Object.keys(previousProps).every(key => typeof previousProps[key] === 'function' || previousProps[key] === nextProps[key])
    && Object.keys(nextProps).every(key => typeof nextProps[key] === 'function' || previousProps[key] === nextProps[key]);
}

export default memo(EventItem, (previous, next) => previous.row === next.row
  && previous.today === next.today
  && previous.open === next.open
  && previous.selected === next.selected
  && previous.disabled === next.disabled
  && previous.pendingEdit === next.pendingEdit
  && previous.bookmarkPending === next.bookmarkPending
  && previous.confirmPending === next.confirmPending
  && previous.showSource === next.showSource
  && previous.saved === next.saved
  && previous.selectionEnabled === next.selectionEnabled
  && (!previous.open || sameEditor(previous.editor, next.editor)));
