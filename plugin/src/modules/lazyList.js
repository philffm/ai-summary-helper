// lazyList.js — a list that loads as it is scrolled: the first page at once, the next one when the end of the scroll area is near
// (infinite scroll, no button). Used by the lists on the home page. → { pager, fill }; fill() tops up a list that is taller than its pages.
import { pager as makePager } from './homeWidgets.js';

export function lazyList(scroller, ul, items, build, { size = 12, margin = 160, doc = document } = {}) {
  const pg = makePager(items, size);
  const more = () => { pg.next().forEach((it) => { const li = doc.createElement('li'); li.append(build(it)); ul.append(li); }); };
  more();
  const near = () => scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - margin;
  scroller.addEventListener('scroll', () => { let guard = 0; while (pg.more() && near() && guard++ < 50) more(); }, { passive: true });
  const fill = () => { let guard = 0; while (pg.more() && scroller.clientHeight && scroller.scrollHeight <= scroller.clientHeight && guard++ < 50) more(); };
  return { pager: pg, fill };
}
