/* eslint-disable @next/next/no-img-element -- local component harness, no image service. */
import type {ImgHTMLAttributes} from 'react';
export default function Image({unoptimized: _unoptimized, priority: _priority, loader: _loader, ...props}:ImgHTMLAttributes<HTMLImageElement>&{unoptimized?:boolean;priority?:boolean;loader?:unknown}){void _unoptimized;void _priority;void _loader;return <img {...props} alt={props.alt??''}/>;}
