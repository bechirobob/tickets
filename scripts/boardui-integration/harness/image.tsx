import type { ImgHTMLAttributes } from 'react';
export default function Image({unoptimized: _unoptimized, priority: _priority, ...props}:ImgHTMLAttributes<HTMLImageElement>&{unoptimized?:boolean;priority?:boolean}){void _unoptimized; void _priority; return <img {...props} alt={props.alt??''}/>;}
