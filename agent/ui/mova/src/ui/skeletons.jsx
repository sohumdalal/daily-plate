// Each page's loading shape, built from Mova's skeleton. Every shape matches
// the content it stands in for, so nothing jumps when the content arrives.

import { Skeleton } from './skeleton.jsx';

const Lines = ({ widths }) => (
  <div className="flex flex-col gap-4">
    {widths.map((w, i) => (
      <Skeleton key={i} className="h-3.5" style={{ width: w }} />
    ))}
  </div>
);

const Specs = ({ n = 4 }) => (
  <div className="grid gap-6" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
    {Array.from({ length: n }, (_, i) => (
      <div key={i} className="flex flex-col gap-4">
        <Skeleton className="w-16 h-11" />
        <Skeleton className="w-20 h-2.5" />
      </div>
    ))}
  </div>
);

/** One chart card: title, value, plot, footer. */
const Card = ({ wide }) => (
  <div className={`mova-skeleton-card flex flex-col gap-3 p-5 ${wide ? 'col-span-full' : ''}`}>
    <Skeleton className="w-28 h-2.5" />
    <Skeleton className="w-20 h-6" />
    <Skeleton className={wide ? 'h-32' : 'h-44'} />
    <div className="flex justify-between">
      <Skeleton className="w-24 h-2.5" />
      <Skeleton className="w-20 h-2.5" />
    </div>
  </div>
);

const Charts = ({ period }) => (
  <div className="mova-skeleton-grid grid gap-4">
    {period === 'year' ? (
      <>
        <Card wide />
        <Card />
        <Card />
      </>
    ) : (
      <>
        <Card />
        <Card />
        <Card />
        <Card />
      </>
    )}
  </div>
);

const Rule = () => <div className="mova-skeleton-rule my-8" />;

const SHAPES = {
  // The Wrap tab's day: date, four numbers, then the written wrap.
  day: () => (
    <>
      <Skeleton className="w-56 h-3" />
      <Rule />
      <Specs />
      <Rule />
      <Skeleton className="w-24 h-2.5 mb-6" />
      <Lines widths={['100%', '62%', '100%', '84%']} />
    </>
  ),
  // A week, month or year: the period's name, its charts, then the wrap.
  rollup: ({ period }) => (
    <>
      <Skeleton className="w-56 h-3" />
      <div className="my-8">
        <Charts period={period} />
      </div>
      <Lines widths={['100%', '62%', '84%']} />
    </>
  ),
  charts: ({ period }) => <Charts period={period} />,
  goals: () => <Lines widths={['100%', '62%', '84%']} />,
  feedback: () => (
    <div className="flex flex-col gap-8">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-3">
          <Skeleton className="w-40 h-2.5" />
          <Lines widths={['100%', '72%']} />
        </div>
      ))}
    </div>
  ),
  // The plate: date, four counts, the add box, then rows of items.
  plate: () => (
    <>
      <Skeleton className="w-40 h-3" />
      <div className="my-8">
        <Specs />
      </div>
      <Skeleton className="h-11 mb-12" />
      <Skeleton className="w-32 h-2.5 mb-6" />
      <div className="flex flex-col">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="mova-skeleton-row flex gap-4 py-4">
            <Skeleton className="w-5 h-5 shrink-0" />
            <div className="flex flex-col gap-3 flex-1 min-w-0">
              <Skeleton className="h-3.5" style={{ width: `${[88, 64, 76, 52, 70][i]}%` }} />
              <Skeleton className="w-36 h-2.5" />
            </div>
          </div>
        ))}
      </div>
    </>
  ),
};

export function PageSkeleton({ shape, period }) {
  const Shape = SHAPES[shape];
  return (
    <div className="mova" aria-hidden="true">
      <Shape period={period} />
    </div>
  );
}
