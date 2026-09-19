import './globals.css'
import type { ReactNode } from 'react'
import { ThemeSync } from './ThemeSync'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Qunvert',
  description:
    'Qunvert is a WhatsApp AI agent that automates customer conversations and product campaigns.',
}

const themeScript = `(function(){try{
  var KEY='fm_theme';
  function norm(v){if(v==null)return null;v=String(v).toLowerCase();
    if(v==='dark'||v==='night'||v==='1'||v==='true') return true;
    if(v==='light'||v==='day'||v==='0'||v==='false') return false;
    return null;}
  function paramDark(){try{
    var q=new URLSearchParams(location.search);
    var names=['fm_theme','fmtheme','theme','mode','scheme'];
    for(var i=0;i<names.length;i++){var d=norm(q.get(names[i])); if(d!==null) return d;}
    return null;
  }catch(e){return null;}}
  function storedDark(){try{return norm(localStorage.getItem(KEY));}catch(e){return null;}}
  var dark=paramDark();
  if(dark!==null){try{localStorage.setItem(KEY,dark?'dark':'light');}catch(e){}}
  if(dark===null) dark=storedDark();
  if(dark===null) dark=(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  var el=document.documentElement;
  el.classList.toggle('dark', !!dark);
  el.style.colorScheme = dark ? 'dark' : 'light';
}catch(e){}})();`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-[#f5f5f7] dark:bg-black min-h-screen text-[#1d1d1f] dark:text-white antialiased">
        <ThemeSync />
        {children}
      </body>
    </html>
  )
}
