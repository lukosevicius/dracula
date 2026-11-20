import type { ReactNode } from 'react';
import type { ReviewStatus } from '../../types';
import { formatDate, labels, plainText, priceInfo, reviews, sourceNames, type EventRow } from './data';
import { Icon } from './workspace';

const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });

export default function EventItem({ row, today, open, toggle, selected, select, disabled, review, confirm, editor, showSource, saved, toggleSaved, selectionEnabled = true }: {
  row: EventRow; today: string; open: boolean; toggle: () => void; selected: boolean;
  select: (checked: boolean) => void; disabled: boolean; review: (status: ReviewStatus) => void;
  confirm: () => void; editor: ReactNode; showSource: boolean; saved: boolean; toggleSaved: () => void;
  selectionEnabled?: boolean;
}) {
  const title = plainText(row.title);
  const assistantPending = !!row.assistant_reviewed_at && !row.assistant_confirmed_at;
  const date = row.event_date ? formatDate(row.event_date) : 'Date unknown';
  const past = !!row.event_date && (row.event_end_date || row.event_date) < today;
  const prepared = row.review_status === 'music' && !past;
  const time = row.event_time?.slice(0, 5);
  const price = priceInfo(row);
  return (
    <article className={`event-item ${open ? 'event-open' : ''} ${selected ? 'event-selected' : ''}`}>
      <div className={`event-row ${selectionEnabled ? '' : 'event-row-saved'}`}>
        {selectionEnabled && <input type="checkbox" aria-label={`Select ${title}`} checked={selected} disabled={disabled} onChange={event => select(event.target.checked)} />}
        <div className="event-date" aria-label={date} title={date}>
          <span>{row.event_date ? monthFormatter.format(new Date(`${row.event_date}T12:00:00Z`)) : 'Date'}</span>
          <strong>{row.event_date?.slice(8, 10) || '—'}</strong>
        </div>
        <button type="button" className="event-title" aria-expanded={open} aria-controls={open ? `event-details-${row.id}` : undefined} onClick={toggle}>
          <strong>{title}</strong>
          <span>
            {row.event_date && row.event_date.slice(0, 4) !== today.slice(0, 4) && <span>{row.event_date.slice(0, 4)}</span>}
            {time && <span title="Event time"><Icon name="clock" size={13} /> {time}</span>}
            {row.venue && <span title="Venue"><Icon name="pin" size={13} /> {row.venue}</span>}
            {(price.text || price.type === 'free' || price.type === 'paid') && <span title="Price"><Icon name="ticket" size={13} /> {price.text || (price.type === 'free' ? 'Free' : 'Paid')}</span>}
            {!time && !row.venue && !price.text && price.type === 'unknown' && <span>Details incomplete</span>}
            {showSource && <span>{sourceNames[row.source_key] ?? row.source_key}</span>}
          </span>
        </button>
        <div className="event-review">
          <label className={`review-select review-${row.review_status}`}>
            <select aria-label={`Review status for ${title}`} value={row.review_status} disabled={disabled} onChange={event => review(event.target.value as ReviewStatus)}>
              {reviews.map(status => <option key={status} value={status}>{labels[status]}</option>)}
            </select>
            <Icon name="down" size={13} />
          </label>
          <small>{assistantPending ? 'Needs your check' : past ? 'Past event' : prepared ? 'Ready for Dracula' : ''}</small>
        </div>
        <button type="button" className="icon-button save-event-button" aria-label={saved ? `Remove ${title} from saved events` : `Save ${title}`} aria-pressed={saved} aria-busy={disabled} disabled={disabled} title={saved ? 'Remove from saved events' : 'Save event'} onClick={toggleSaved}><Icon name="save" /></button>
        <button type="button" className="icon-button event-expand" aria-label={`${open ? 'Hide' : 'Show'} details for ${title}`} aria-expanded={open} aria-controls={open ? `event-details-${row.id}` : undefined} onClick={toggle}><Icon name="down" /></button>
      </div>
      {open && (
        <div className="event-details" id={`event-details-${row.id}`}>
          {assistantPending && (
            <div className="assistant-note">
              <div><strong>Assistant review</strong><p>{row.assistant_notes || 'No notes provided.'}</p></div>
              <button className="secondary-button" type="button" disabled={disabled} onClick={confirm}><Icon name="check" size={15} /> Mark as checked</button>
            </div>
          )}
          {editor}
        </div>
      )}
    </article>
  );
}
