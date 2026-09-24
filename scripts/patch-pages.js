const fs = require('fs');

const file = 'pages/index.js';
let code = fs.readFileSync(file, 'utf8');

const target = 'function up(){const e=k.useRef(null),t=k.useRef(null),{sessionId:n}=Ha(),[r,i]=k.useState("");return k.useEffect(()=>{if(n)return Al(n).then(s=>{i(s.name)}).catch(s=>{console.error(s)}),Dl(n).then(s=>{if(!e.current||t.current)return;const o=chrome.runtime.getManifest(),a=o.version_name||o.version,u=document.createElement("link");u.href=`https://cdn.jsdelivr.net/npm/rrweb-player@${a}/dist/style.min.css`,u.rel="stylesheet",document.head.appendChild(u),t.current=new ap({target:e.current,props:{events:s,autoPlay:!0}})}).catch(s=>{console.error(s)}),()=>{var s,o;(s=t.current)==null||s.pause(),(o=t.current)==null||o.$destroy()}},[n]),M.jsxs(M.Fragment,{children:[M.jsxs(nl,{mb:5,fontSize:"md",children:[M.jsx(Hr,{children:M.jsx(tn,{href:"#",children:"Sessions"})}),M.jsx(Hr,{children:M.jsx(tn,{children:r})})]}),M.jsx(fl,{children:M.jsx(tl,{ref:e})})]})}';

const replacement = 'function up(){const e=k.useRef(null),t=k.useRef(null),{sessionId:n}=Ha(),[r,i]=k.useState(""),[sess,setSess]=k.useState(null);return k.useEffect(()=>{if(n)return Al(n).then(s=>{i(s.name);setSess(s);}).catch(s=>{console.error(s)}),Dl(n).then(s=>{if(!e.current||t.current)return;const o=chrome.runtime.getManifest(),a=o.version_name||o.version,u=document.createElement("link");u.href=`https://cdn.jsdelivr.net/npm/rrweb-player@${a}/dist/style.min.css`,u.rel="stylesheet",document.head.appendChild(u),t.current=new ap({target:e.current,props:{events:s,autoPlay:!0}})}).catch(s=>{console.error(s)}),()=>{var s,o;(s=t.current)==null||s.pause(),(o=t.current)==null||o.$destroy()}},[n]),M.jsxs(M.Fragment,{children:[M.jsxs(De,{justifyContent:"space-between",alignItems:"center",mb:5,children:[M.jsxs(nl,{fontSize:"md",children:[M.jsx(Hr,{children:M.jsx(tn,{href:"#",children:"Sessions"})}),M.jsx(Hr,{children:M.jsx(tn,{children:r})})]}),sess&&sess.har&&M.jsx(_n,{size:"sm",colorScheme:"blue",onClick:()=>{const blob=new Blob([JSON.stringify(sess.har,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=(sess.name||"session").replace(/[/\\\\?%*:|"<>]/g,"_")+".har";document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);},children:"📥 Download HAR (.har)"})]}),M.jsx(fl,{children:M.jsx(tl,{ref:e})})]})}';

if (!code.includes(target)) {
  console.error('Target function up() not found');
  process.exit(1);
}

code = code.replace(target, replacement);
fs.writeFileSync(file, code, 'utf8');
console.log('pages/index.js successfully patched with Download HAR button!');
