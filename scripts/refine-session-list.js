const fs = require('fs');

const file = 'pages/index.js';
let code = fs.readFileSync(file, 'utf8');

const target = 'M.jsxs(De,{gap:8,align:"center",mr:4,children:[M.jsx(pl,{variant:"outline",size:"md",value:m.getState().pagination.pageSize,onChange:v=>{m.setPageSize(Number(v.target.value))},children:[10,20,30,40,50].map(v=>M.jsxs("option",{value:v,children:["Show ",v," items"]},v))}),Object.keys(a).length>0&&M.jsxs(De,{gap:1,children:[M.jsx(_n,{mr:4,size:"md",colorScheme:"red",onClick:()=>{if(m.getSelectedRowModel().flatRows.length===0)return;const v=m.getSelectedRowModel().flatRows.map(y=>y.original.id);Zc(v).then(()=>{u({}),C(),ss.emit(Wi.SessionUpdated,{})})},children:"Delete"}),M.jsx(_n,{mr:4,size:"md",colorScheme:"green",onClick:()=>{const v=m.getSelectedRowModel().flatRows;v.length!==0&&ef(v.map(y=>y.original.id))},children:"Download"}),M.jsx(_n,{mr:4,size:"md",colorScheme:"blue",onClick:()=>{const v=m.getSelectedRowModel().flatRows;v.length!==0&&exportHar(v.map(y=>y.original.id))},children:"Download HAR"})]})]})';

const replacement = 'M.jsxs(De,{gap:3,align:"center",mr:4,children:[M.jsx(pl,{variant:"outline",size:"sm",value:m.getState().pagination.pageSize,onChange:v=>{m.setPageSize(Number(v.target.value))},children:[10,20,30,40,50].map(v=>M.jsxs("option",{value:v,children:["Show ",v," items"]},v))}),Object.keys(a).length>0&&M.jsxs(De,{gap:2,children:[M.jsx(_n,{size:"sm",colorScheme:"red",onClick:()=>{if(m.getSelectedRowModel().flatRows.length===0)return;const v=m.getSelectedRowModel().flatRows.map(y=>y.original.id);Zc(v).then(()=>{u({}),C(),ss.emit(Wi.SessionUpdated,{})})},children:"Delete"}),M.jsx(_n,{size:"sm",colorScheme:"green",onClick:()=>{const v=m.getSelectedRowModel().flatRows;v.length!==0&&ef(v.map(y=>y.original.id))},children:"Download"}),M.jsx(_n,{size:"sm",colorScheme:"blue",onClick:()=>{const v=m.getSelectedRowModel().flatRows;v.length!==0&&exportHar(v.map(y=>y.original.id))},children:"Download HAR"})]})]})';

if (!code.includes(target)) {
  console.error('Target not found in pages/index.js');
  process.exit(1);
}

code = code.replace(target, replacement);
fs.writeFileSync(file, code, 'utf8');
console.log('Successfully adjusted action buttons layout in session list.');
