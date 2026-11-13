import { vilniusDate, selectedDates, matchesDate } from './event-date-filters.js';
const form = document.querySelector('#event-import-form');
const pages = document.querySelector('#event-pages');
const status = document.querySelector('#event-status');
const list = document.querySelector('#event-list');
const runs = document.querySelector('#event-runs');
const enrichButton = document.querySelector('#enrich-events');
const refreshDetailsButton = document.querySelector('#refresh-details');
const plain = (html) => new DOMParser().parseFromString(html || '', 'text/html').body.textContent.trim();
let currentData = null;
const whenFilter = document.querySelector('#event-when');
const reviewFilter = document.querySelector('#event-review');
const fromInput = document.querySelector('#event-date-from');
const toInput = document.querySelector('#event-date-to');
const customDates = document.querySelector('#event-custom-dates');
const dateHint = document.querySelector('#event-date-hint');
const dateError = document.querySelector('#event-date-error');
const dateButtons = [...document.querySelectorAll('[data-date-filter]')];
const make = (tag, text) => { const el=document.createElement(tag); if (text !== undefined) el.textContent=text; return el; };
async function save(path, body) {
  const response = await fetch(path, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not save.');
  render(result.dashboard);
}
function externalLink(url, label) {
  try { const parsed=new URL(url); if (!['http:','https:'].includes(parsed.protocol)) return null; const a=make('a',label); a.href=parsed.href; a.target='_blank'; a.rel='noopener noreferrer'; return a; } catch { return null; }
}
function eventDescription(html, sourceUrl) {
  const result = document.createDocumentFragment();
  const allowed = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div', 'a']);
  const discarded = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'form', 'noscript']);
  function copy(node, parent) {
    if (node.nodeType === Node.TEXT_NODE) { parent.append(document.createTextNode(node.textContent)); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.localName;
    if (discarded.has(tag)) return;
    let target = parent;
    if (allowed.has(tag)) {
      if (tag === 'a') {
        try {
          const url = new URL(node.getAttribute('href'), sourceUrl);
          if (node.hasAttribute('href') && ['http:', 'https:'].includes(url.protocol)) {
            target = make('a'); target.href = url.href; target.target = '_blank'; target.rel = 'noopener noreferrer'; parent.append(target);
          }
        } catch { /* Keep the link text without an invalid URL. */ }
      } else { target = make(tag); parent.append(target); }
    }
    for (const child of node.childNodes) copy(child, target);
  }
  const parsed = new DOMParser().parseFromString(html || '', 'text/html');
  for (const child of parsed.body.childNodes) copy(child, result);
  return result;
}
function renderEvents(data) {
  const openIds = new Set([...list.querySelectorAll('details[open]')].map(el => el.dataset.eventId));
  list.replaceChildren();
  const date=vilniusDate(), when=whenFilter.value, review=reviewFilter.value;
  const range=selectedDates(when,fromInput.value,toInput.value);
  customDates.hidden=when!=='custom'; dateHint.hidden=when!=='custom';
  dateError.hidden=!range?.error || (!fromInput.value && !toInput.value); dateError.textContent=range?.error || '';
  dateButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.dateFilter===when)));
  const visible=data.events.filter(e => (review==='all' || e.review_status===review) && matchesDate(e,when,range,date));
  if (when!=='all' && when!=='unknown') visible.sort((a,b)=>{
    if (!a.event_date) return b.event_date ? 1 : 0;
    if (!b.event_date) return -1;
    const order=a.event_date.localeCompare(b.event_date) || (a.event_time || '99:99').localeCompare(b.event_time || '99:99');
    return when==='past' ? -order : order;
  });
  document.querySelector('#event-visible-count').textContent = `${visible.length.toLocaleString()} shown`;
  if (!visible.length && !range?.error) { const empty=make('div','No events match these filters.'); empty.className='event-empty'; list.append(empty); }
  for (const event of visible) {
    const details=make('details'); details.className='event-item'; details.dataset.eventId=event.source_id; details.open=openIds.has(String(event.source_id));
    const summary=make('summary'); summary.className='event-item-summary';
    const dateBadge=make('span'); dateBadge.className='event-date-badge';
    if (event.event_date) { const d=new Date(`${event.event_date}T12:00:00Z`); const month=make('span',new Intl.DateTimeFormat('en',{month:'short',timeZone:'UTC'}).format(d).toUpperCase()); const day=make('strong',String(d.getUTCDate()).padStart(2,'0')); dateBadge.append(month,day); } else { dateBadge.append(make('span','DATE'),make('strong','—')); }
    const main=make('span'); main.className='event-item-main'; const title=make('strong',plain(event.title)); title.className='event-item-title'; const meta=make('span'); meta.className='event-item-meta'; meta.textContent=[event.event_date ? event.event_date.slice(0,4) : 'Date unknown',event.event_time || null,event.venue || 'Venue unknown'].filter(Boolean).join('  ·  '); main.append(title,meta);
    const badge=make('span',({unsure:'Unsure',music:'Music',not_music:'Not music'})[event.review_status] || 'Unsure'); badge.className=`event-review-badge event-review-${event.review_status}`;
    const chevron=make('span','⌄'); chevron.className='event-item-chevron'; chevron.setAttribute('aria-hidden','true'); summary.append(dateBadge,main,badge,chevron); details.append(summary);
    const body=make('div'); body.className='event-item-body';
    const editor=make('form'); editor.className='event-editor';
    const fields=[['event_date','EVENT DATE','date'],['event_end_date','CALENDAR END DATE','date'],['event_time','TIME','time'],['venue','VENUE','text'],['ticket_url','TICKET URL','url']];
    const manualFields=JSON.parse(event.manual_fields || '[]');
    for (const [name,label,type] of fields) { const wrapper=make('label',label+(manualFields.includes(name)?' · MANUAL':'')), input=make('input'); input.name=name; input.type=type; input.value=event[name] || ''; wrapper.append(input); editor.append(wrapper); }
    const reviewLabel=make('label','REVIEW STATUS'), select=make('select'); select.name='review_status';
    for (const [value,label] of [['unsure','Unsure'],['music','Music'],['not_music','Not music']]) { const option=make('option',label); option.value=value; option.selected=event.review_status===value; select.append(option); }
    reviewLabel.append(select); editor.append(reviewLabel);
    const saveButton=make('button','Save changes'); saveButton.type='submit'; saveButton.className='primary-button'; editor.append(saveButton);
    editor.addEventListener('submit',async e=>{e.preventDefault();saveButton.disabled=true;try{await save('/api/vilnius-events/update',{id:event.source_id,...Object.fromEntries(new FormData(editor))});status.textContent='Event saved.';}catch(err){status.textContent=err.message;saveButton.disabled=false;}});
    body.append(editor);
    const artists=make('div'); artists.className='event-artists'; const artistsTitle=make('h3','Artists'); artists.append(artistsTitle);
    const linked=make('p', 'Confirmed: '+(event.artist_links.map(a=>a.name).join(', ') || 'None yet')); linked.className='event-artist-caption'; artists.append(linked);
    for (const artist of event.artist_links) { const button=make('button',`Remove ${artist.name}`); button.type='button'; button.className='event-artist-action'; button.addEventListener('click',()=>save('/api/vilnius-events/artist',{id:event.source_id,mbid:artist.artist_mbid,decision:'remove'}).catch(e=>{status.textContent=e.message;})); artists.append(button); }
    const heading=make('p','SUGGESTED MATCHES'); heading.className='event-artist-label'; artists.append(heading);
    if (!event.artist_suggestions.length) { const empty=make('p','No suggestions yet.'); empty.className='event-artist-caption'; artists.append(empty); }
    for (const artist of event.artist_suggestions) { const row=make('div'); row.className='event-artist-row'; const label=make('div'); label.append(make('strong',`${artist.name} · ${artist.reason}`)); if(artist.excerpt){const excerpt=make('p',`“${artist.excerpt}”`);excerpt.className='event-artist-caption';label.append(excerpt);} row.append(label); const actions=make('span'); for (const [decision,text] of [['accepted','Accept'],['dismissed','Dismiss']]) {const button=make('button',text);button.type='button';button.className='event-artist-action';button.addEventListener('click',()=>save('/api/vilnius-events/artist',{id:event.source_id,mbid:artist.mbid,decision}).catch(e=>{status.textContent=e.message;}));actions.append(button);}row.append(actions);artists.append(row); }
    body.append(artists);
    const description=make('div'); description.className='event-description'; description.append(eventDescription(event.content_html, event.source_url)); if (!description.textContent.trim()) description.textContent='No description available.'; body.append(description);
    const links=make('div'); links.className='event-item-links'; const source=externalLink(event.source_url,'View original event ↗'); if(source) links.append(source); body.append(links); const checked=make('p',event.details_checked_at ? `Details checked ${new Date(event.details_checked_at).toLocaleString()}` : 'Details need checking or refreshing'); checked.className='event-checked';body.append(checked);details.append(body);
    const row=make('div'); row.className='event-row'; row.append(details);
    const quick=make('div');quick.className='event-quick-review';quick.setAttribute('aria-label',`Review ${plain(event.title)}`);
    for(const [value,label] of [['music','Music'],['not_music','Not music'],['unsure','Unsure']]) {const button=make('button',label);button.type='button';button.setAttribute('aria-pressed',String(event.review_status===value));button.addEventListener('click',async()=>{button.disabled=true;try{await save('/api/vilnius-events/review',{id:event.source_id,review_status:value});status.textContent='Review saved.';}catch(error){status.textContent=error.message;button.disabled=false;}});quick.append(button);}row.append(quick);
    if(event.ticket_url){const ticket=externalLink(event.ticket_url,'Tickets ↗'); if(ticket){ticket.className='event-row-ticket';row.append(ticket);}} list.append(row);
  }
}
whenFilter.addEventListener('change',()=>currentData && renderEvents(currentData));
reviewFilter.addEventListener('change',()=>currentData && renderEvents(currentData));
for (const input of [fromInput,toInput]) input.addEventListener('input',()=>currentData && renderEvents(currentData));
for (const button of dateButtons) button.addEventListener('click',()=>{whenFilter.value=whenFilter.value===button.dataset.dateFilter?'upcoming':button.dataset.dateFilter; if(currentData)renderEvents(currentData);});
function render(data) {
  currentData=data;
  document.querySelector('#event-total').textContent = data.total.toLocaleString();
  const counts={music:0,not_music:0,unsure:0}; for(const event of data.events) counts[event.review_status]++;
  document.querySelector('#event-review-counts').textContent=`Music ${counts.music} · Not music ${counts.not_music} · Unsure ${counts.unsure} · Unknown date ${data.events.filter(e=>!e.event_date).length}`;
  document.querySelector('#event-next-page').textContent = `Page ${data.nextPage}`;
  const last = data.runs[0];
  document.querySelector('#event-last-run').textContent = last ? new Date(last.started_at).toLocaleDateString(undefined, {month:'short',day:'numeric',year:'numeric'}) : 'Never';
  document.querySelector('#event-last-summary').textContent = last ? `${last.added_count} added · ${last.status}` : 'No imports yet';
  document.querySelector('#event-position').textContent = `Page ${data.nextPage} is next · Continuing also refreshes the newest and previous pages`;
  renderEvents(data);
  runs.replaceChildren();
  if (!data.runs.length) runs.textContent = 'No imports yet.';
  for (const run of data.runs) {
    const row = document.createElement('p');
    row.textContent = `${new Date(run.started_at).toLocaleString()} · ${run.status} · ${run.fetched_count} fetched · ${run.added_count} added · ${run.updated_count} updated${run.error_message ? ` · ${run.error_message}` : ''}`;
    runs.append(row);
  }
  form.querySelectorAll('button').forEach((button) => { button.disabled = data.running; });
  enrichButton.disabled = data.running;
  refreshDetailsButton.disabled = data.running;
}
async function load() {
  const response = await fetch('/api/vilnius-events');
  if (!response.ok) throw new Error('Could not load event imports.');
  render(await response.json());
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const count = Number(pages.value);
  if (!Number.isInteger(count) || count < 1 || count > 10) { status.textContent = 'Choose between 1 and 10 pages.'; return; }
  const restart = event.submitter?.value === 'start';
  const sample = event.submitter?.value === 'sample';
  const refresh = event.submitter?.value === 'refresh';
  form.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  status.textContent = 'Importing events…';
  try {
    const response = await fetch('/api/vilnius-events/import', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pages:count,restart,sample,refresh})});
    const result = await response.json();
    if (result.dashboard) render(result.dashboard);
    if (!response.ok) throw new Error(result.error || 'Import failed.');
    status.textContent = `Imported ${result.result.fetched}: ${result.result.added} added, ${result.result.updated} refreshed.`;
  } catch (error) { status.textContent = error.message; await load().catch(() => {}); }
  finally { form.querySelectorAll('button').forEach((button) => { button.disabled = false; }); }
});
async function enrichEvents(refresh) {
  enrichButton.disabled=true; refreshDetailsButton.disabled=true; form.querySelectorAll('button').forEach(button=>{button.disabled=true;}); status.textContent='Fetching event details…';
  try { const response=await fetch('/api/vilnius-events/enrich',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refresh})}); const result=await response.json(); if(result.dashboard)render(result.dashboard); if(!response.ok)throw new Error(result.error||'Could not fetch details.'); status.textContent=`Checked ${result.result.checked} events; found page details for ${result.result.enriched}.`; }
  catch(error){status.textContent=error.message;await load().catch(()=>{});}
  finally {enrichButton.disabled=false;refreshDetailsButton.disabled=false;form.querySelectorAll('button').forEach(button=>{button.disabled=false;});}
}
enrichButton.addEventListener('click',()=>enrichEvents(false));
refreshDetailsButton.addEventListener('click',()=>enrichEvents(true));
load().catch((error) => { status.textContent = error.message; });
