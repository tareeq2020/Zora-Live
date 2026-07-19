'use client';

/* The "THE NIGHTS" carousel section from public/about.html — a client island
   because its prev/next buttons scroll the track (the legacy inline <script>).
   step() and scrollBy match the original exactly. */

import { useRef } from 'react';
import { RevealImg } from '../../components/reveal-img';

const SLIDES = [
  { a: '#B23A17', label: 'FESTIVAL', img: '/assets/event-01.jpg', cap: <><b>Offshore</b> — daytime yacht groove</> },
  { a: '#3D2A8F', label: 'NIGHTLIFE', img: '/assets/event-02.jpg', cap: <><b>Basement 001</b> — Dar es Salaam</> },
  { a: '#0F6E56', label: 'ARTIST', img: '/assets/event-05.jpg', cap: <><b>Guest selectors</b> — live sets</> },
  { a: '#1E4FD8', label: 'CROWD', img: '/assets/event-06.jpg', cap: <><b>Sunset Social</b> — Coco Beach</> },
  { a: '#C46A28', label: 'DAYTIME', img: '/assets/event-03.jpg', cap: <><b>Garden Brunch</b> — the city's daytime</> },
  { a: '#993556', label: 'FESTIVAL', img: '/assets/event-04.jpg', cap: <><b>Palmwine Festival</b> — Lagos</> },
];

export function AboutCarousel() {
  const carRef = useRef<HTMLDivElement>(null);
  const step = () => Math.min((carRef.current?.clientWidth ?? 0) * 0.8, 380);
  const scroll = (dir: number) => carRef.current?.scrollBy({ left: dir * step(), behavior: 'smooth' });

  return (
    <section>
      <div className="wrap">
        <div className="car-head">
          <div>
            <p className="kicker">THE NIGHTS</p>
            <h2>Past events, artists, crowds.</h2>
          </div>
          <div className="car-nav">
            <button id="car-prev" aria-label="Previous" onClick={() => scroll(-1)}>&#8249;</button>
            <button id="car-next" aria-label="Next" onClick={() => scroll(1)}>&#8250;</button>
          </div>
        </div>
        <div className="carousel" id="carousel" ref={carRef}>
          {SLIDES.map((s, i) => (
            <div className="slide" key={i}>
              <div className="ph" style={{ ['--a' as string]: s.a }} data-label={s.label}>
                <RevealImg src={s.img} alt="" />
              </div>
              <p className="cap">{s.cap}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
