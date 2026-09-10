import type { ImgHTMLAttributes } from 'react';
import { WEB_ORIGIN } from '../catalogue';
export type ImageLoaderProps = { src: string; width: number; quality?: number };
type Props = ImgHTMLAttributes<HTMLImageElement> & { src: string; priority?: boolean; unoptimized?: boolean; loader?: (props: ImageLoaderProps) => string; fill?: boolean; quality?: number };
export default function Image({ src, priority, unoptimized: _unoptimized, loader: _loader, fill: _fill, quality: _quality, loading, ...props }: Props) {
  // Public event artwork follows live catalogue updates. Brand assets are bundled.
  const source = src.startsWith('/events/') ? new URL(src, WEB_ORIGIN).href : src;
  return <img {...props} src={source} loading={priority ? 'eager' : loading ?? 'lazy'} decoding="async" />;
}
