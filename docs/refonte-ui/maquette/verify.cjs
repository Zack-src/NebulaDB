/* QA DOM sans navigateur : passer le chemin de l'installation jsdom en argument. */
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require(process.argv[2] || 'jsdom');
const errors = [], failures = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', e => errors.push(e.message));
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
const dom = new JSDOM(html, { url:'https://maquette.example.test/', runScripts:'dangerously', virtualConsole, pretendToBeVisual:true,
  beforeParse(w) { w.ResizeObserver = class { observe(){} disconnect(){} }; w.matchMedia = () => ({matches:false,addEventListener(){}}); w.HTMLElement.prototype.scrollIntoView = function(){}; w.URL.createObjectURL = ()=>'blob:demo'; w.URL.revokeObjectURL = ()=>{}; }
});
const w = dom.window;
const get = code => w.eval(code);
const catalog = get('CATALOG');
for (const [family,title,view,section] of catalog) {
  try {
    get(`routeTo(${JSON.stringify(view)},${JSON.stringify(section || '')})`);
    if(!w.document.querySelector('#view').textContent.trim())throw Error('Écran vide');
    if(w.document.querySelector('#view').textContent.includes('undefined') && title !== 'Erreurs') throw Error('Texte undefined');
  } catch(e){failures.push({family,title,error:e.message});}
}
const assert=(name,code)=>{try{if(!get(code))throw Error('Assertion échouée');}catch(e){failures.push({test:name,error:e.message});}};
assert('SQL : nouvel onglet',`(()=>{routeTo('sql');const n=QUERIES2.length;$('[data-newq]').click();return QUERIES2.length===n+1&&!!$('.sql-input');})()`);
assert('SQL : édition persistée',`(()=>{const e=$('.sql-input');e.value='select * from products';e.dispatchEvent(new Event('input',{bubbles:true}));return DEMO.sqlDrafts[S.sqlTab]===e.value;})()`);
assert('Catalogue : filtre',`(()=>{routeTo('catalog');const i=$('#catalogSearch');i.value='invitation';i.dispatchEvent(new Event('input'));return $$('.screen-card').length>0&&$$('.screen-card').every(c=>c.textContent.toLowerCase().includes('invitation'));})()`);
assert('Rôle lecteur : administration bloquée',`(()=>{DEMO.role='Lecteur';routeTo('admin','Utilisateurs');const ok=$('#view').textContent.includes('Accès réservé');DEMO.role='Admin';return ok;})()`);
assert('Navigation : section administration conservée',`(()=>{ACT.goadm({dataset:{arg:'Plugins'}});return S.admSec==='Plugins'&&$('#view').textContent.includes('Catalogue');})()`);
assert('Plugin : installation',`(()=>{routeTo('detail','Plugins');DEMO.plugins=DEMO.plugins.filter(p=>p!=='Export Mermaid');ACT.pluginInstall({dataset:{arg:'Export Mermaid'}});$('#dSave').click();return DEMO.plugins.includes('Export Mermaid');})()`);
assert('Plugin : désinstallation',`(()=>{ACT.pluginRemove({dataset:{arg:'Export Mermaid'}});return !DEMO.plugins.includes('Export Mermaid');})()`);
assert('Relation : validation de colonne',`(()=>{routeTo('detail','Relations');const n=EDGES.length;ACT.relationForm({dataset:{arg:''}});const controls=$$('#drw .in');controls[1].value='missing';$('#dSave').click();return EDGES.length===n&&$('#drw').textContent.includes('colonnes présentes');})()`);
assert('Index : sauvegarde composite',`(()=>{hideDrawer();routeTo('detail','Index et clés composites');ACT.indexForm({dataset:{arg:''}});$('#dSave').click();return DEMO.records.indexes.at(-1).columns.length===2;})()`);
assert('Authentification : connexion, MFA et accueil',`(()=>{routeTo('auth','Connexion');const f=$$('#authForm input');f[0].value='test@example.test';f[1].value='sample-password';$('#authForm').dispatchEvent(new Event('submit',{cancelable:true}));$('input').value='123456';$('#authForm').dispatchEvent(new Event('submit',{cancelable:true}));return S.view==='home';})()`);
assert('Import DBML : validation puis application',`(()=>{routeTo('schema','Importer');ACT.impmode({dataset:{arg:'Coller du code'}});$('textarea').value='Table test_import {\\n id int [pk]\\n}';$$('#view button').find(b=>b.textContent.trim()==='Importer').click();$('#dSave').click();return !!TABLES.test_import;})()`);
assert('Données : ajout en mémoire',`(()=>{routeTo('detail','Gestion des données');const n=dataRows().length;ACT.dataRow({dataset:{arg:''}});const f=$$('#drw input');f[1].value='Test';f[2].value='test@example.test';$('#dSave').click();return dataRows().length===n+1;})()`);
assert('Authentification : validation du mot de passe',`(()=>{routeTo('auth','Réinitialiser le mot de passe');const p=$$('#authForm input');p[0].value='short';p[1].value='different';$('#authForm').dispatchEvent(new Event('submit',{cancelable:true}));return $('#authError').textContent.includes('correspondre');})()`);
for(const state of ['Chargement','Vide','Aucun résultat','Erreur','Hors ligne','Accès refusé','Lecture seule','Conflit']){
  try{get(`routeTo('projects');DEMO.state=${JSON.stringify(state)};render()`);if(!w.document.querySelector('#view').textContent.trim())throw Error('État vide');}catch(e){failures.push({state,error:e.message});}
}
get("DEMO.state='Normal';routeTo('home')");
setTimeout(()=>{console.log(JSON.stringify({screens:catalog.length,failures,runtimeErrors:errors},null,2));dom.window.close();process.exitCode=failures.length||errors.length?1:0;},150);
