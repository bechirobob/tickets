import { createContext, useContext } from 'react';
export const Navigation = createContext<{ pathname: string; navigate: (href: string) => void }>({ pathname: '/', navigate: () => {} });
export const usePathname = () => useContext(Navigation).pathname;
export const useRouter = () => {
  const { navigate } = useContext(Navigation);
  return { push: navigate };
};
