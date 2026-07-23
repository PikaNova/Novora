import type { ReactNode } from 'react';
import { useFitText } from '../hooks/useFitText';

type Props = { as?: 'p' | 'span'; className: string; children: ReactNode; minScale?: number };
export default function FitText({ as = 'p', className, children, minScale }: Props) {
  const ref = useFitText(children, minScale);
  const Tag = as;
  return <Tag ref={ref as any} className={`${className} eao-fit-text`}>{children}</Tag>;
}
