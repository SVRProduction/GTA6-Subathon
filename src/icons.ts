// אייקונים: סט אחד (lucide), 16px, קו 1.5, בצבע הטקסט
import { ChevronLeft, ChevronRight, Download, Hand, MapPin, Play, Share2, X, createElement, type IconNode } from 'lucide';

function icon(node: IconNode, size = 16) {
  const el = createElement(node);
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('stroke-width', '1.5');
  el.setAttribute('aria-hidden', 'true');
  el.classList.add('icon');
  return el;
}

export const ico = {
  close: () => icon(X, 18),
  // בעברית "הבא" הולך שמאלה
  next: () => icon(ChevronLeft),
  prev: () => icon(ChevronRight),
  play: () => icon(Play),
  download: () => icon(Download),
  share: () => icon(Share2),
  pin: () => icon(MapPin),
  hand: () => icon(Hand),
};
