const fs = require('fs');

const file = 'pages/index.js';
let code = fs.readFileSync(file, 'utf8');

// 1. Add exportHar function before tf()
const targetFunc = 'async function ef(e){for(const t of e){const n=await Dl(t),r=await Al(t),i=new Blob([JSON.stringify({session:r,events:n},null,2)],{type:"application/json"}),s=URL.createObjectURL(i),o=document.createElement("a");o.href=s,o.download=`${r.name}.json`,document.body.appendChild(o),o.click(),document.body.removeChild(o),URL.revokeObjectURL(s)}}';

const replacementFunc = 'async function exportHar(e){for(const t of e){const r=await Al(t);if(r&&r.har){const i=new Blob([JSON.stringify(r.har,null,2)],{type:"application/json"}),s=URL.createObjectURL(i),o=document.createElement("a");o.href=s,o.download=`${(r.name||"session").replace(/[/\\\\?%*:|"<>]/g,"_")}.har`,document.body.appendChild(o),o.click(),document.body.removeChild(o),URL.revokeObjectURL(s)}}}' + targetFunc;

if (!code.includes(targetFunc)) {
  console.error('Target async function ef(e) not found');
  process.exit(1);
}

code = code.replace(targetFunc, replacementFunc);

// 2. Add Download HAR button next to Download button in table actions
const targetButton = 'M.jsx(_n,{mr:4,size:"md",colorScheme:"green",onClick:()=>{const v=m.getSelectedRowModel().flatRows;v.length!==0&&ef(v.map(y=>y.original.id))},children:"Download"})';

const replacementButton = targetButton + ',M.jsx(_n,{mr:4,size:"md",colorScheme:"blue",onClick:()=>{const v=m.getSelectedRowModel().flatRows;v.length!==0&&exportHar(v.map(y=>y.original.id))},children:"Download HAR"})';

if (!code.includes(targetButton)) {
  console.error('Target Download button not found');
  process.exit(1);
}

code = code.replace(targetButton, replacementButton);

fs.writeFileSync(file, code, 'utf8');
console.log('Successfully added exportHar and Download HAR button to session list in pages/index.js');
