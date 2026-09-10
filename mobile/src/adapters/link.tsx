import { forwardRef, useContext, type AnchorHTMLAttributes } from 'react';
import { Navigation } from './navigation';
type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string; prefetch?: boolean; replace?: boolean; scroll?: boolean };
/** Standard links; only navigation is adapted for the installed runtime. */
const Link = forwardRef<HTMLAnchorElement, Props>(function Link({ href, onClick, prefetch: _prefetch, replace: _replace, scroll: _scroll, ...props }, ref) {
  const { navigate } = useContext(Navigation);
  return <a {...props} ref={ref} href={href} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(href);
  }} />;
});
export default Link;
