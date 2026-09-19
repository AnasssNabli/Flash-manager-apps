import './globals.css'
import type { ReactNode } from 'react'
import { ThemeSync } from './ThemeSync'

export const metadata = {
  title: 'WhatsApp Business',
  description: 'Connect your WhatsApp Business number and chat with your customers — a FlashManager app',
}

// Resolve the theme before first paint so the app matches the FlashManager host
// (light → white, dark → black) without a flash. The host embeds this app with
// `?fm_theme=<dark|light>` — that explicit signal wins and is persisted, so a
// reload/navigation that drops the param keeps the last host theme. Fallbacks:
// same-origin parent <html>, then the persisted value, then the OS scheme.
// Live changes are handled by <ThemeSync/>.
const themeScript = `(function(){try{
  var KEY='fm_theme';
  function norm(v){if(v==null)return null;v=String(v).toLowerCase();
    if(v==='dark'||v==='night'||v==='1'||v==='true') return true;
    if(v==='light'||v==='day'||v==='0'||v==='false') return false;
    return null;}
  function paramDark(){try{
    var q=new URLSearchParams(location.search);
    var names=['fm_theme','fmtheme','theme','mode','scheme','colorscheme','color-scheme','appearance'];
    for(var i=0;i<names.length;i++){var d=norm(q.get(names[i])); if(d!==null) return d;}
    return null;
  }catch(e){return null;}}
  function storedDark(){try{return norm(localStorage.getItem(KEY));}catch(e){return null;}}
  function lum(el){var m=getComputedStyle(el).backgroundColor.match(/[\\d.]+/g);if(!m)return null;var a=m[3]===undefined?1:parseFloat(m[3]);if(a===0)return null;return (0.299*+m[0]+0.587*+m[1]+0.114*+m[2])/255;}
  function parentDark(){try{
    var fr=window.frameElement; var d=window.parent.document; if(!d||d===document) return null;
    var h=d.documentElement,b=d.body;
    var sig=((h&&h.className)||'')+' '+((b&&b.className)||'');
    var els=[h,b]; for(var j=0;j<els.length;j++){var e=els[j]; if(!e)continue; for(var k=0;k<e.attributes.length;k++){var at=e.attributes[k]; if(/theme|mode|scheme/i.test(at.name)) sig+=' '+at.name+'='+at.value;}}
    sig=sig.toLowerCase();
    if(/\\bdark\\b/.test(sig)) return true;
    if(/\\blight\\b/.test(sig)) return false;
    var node=(fr&&fr.parentElement)||b;
    while(node){var l=lum(node); if(l!==null) return l<0.5; node=node.parentElement;}
    return null;
  }catch(e){return null;}}
  var dark=paramDark();                          // explicit host signal (?fm_theme=)
  if(dark!==null){try{localStorage.setItem(KEY,dark?'dark':'light');}catch(e){}}
  if(dark===null) dark=parentDark();             // same-origin hosts (live read)
  if(dark===null) dark=storedDark();             // last host signal, param dropped
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
      <body className="bg-white dark:bg-[#141414] overscroll-none">
        <ThemeSync />
        {children}
      </body>
    </html>
  )
}
