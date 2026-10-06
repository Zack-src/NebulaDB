/* Extension du prototype : navigation, parcours manquants, états et interactions locales. */
'use strict';
const DEMO = { role: 'Admin', state: 'Normal', pluginTab: 'Catalogue', mfaStep: 0, plugins: ['Export Prisma', 'Règles de nommage Boutique'], sqlDrafts: {}, records: {}, route: '' };
const originalRender = render, originalAdminBody = admBody2, originalSettingsBody = settingsBody2;
const PAGE_SOURCES = {
  auth: 'features/auth', plugins: 'features/plugins/PluginManagerDialog.svelte', settings: 'features/settings',
  schema: 'features/editor/ProjectEditor.svelte', sql: 'features/sql/SqlPanel.svelte', bases: 'features/admin/connections/DbConsole.svelte',
  admin: 'features/admin/AdminConsole.svelte', projects: 'features/projects/ProjectListScreen.svelte', home: 'features/workspace', notifications: 'features/notifications'
};
const AUTH = ['Connexion', 'Mot de passe oublié', 'E-mail envoyé', 'Réinitialiser le mot de passe', 'Double authentification', 'Code de secours', 'Accepter une invitation', 'Invitation expirée', 'Session expirée'];
const EXTRA = ['Plugins', 'Relations', 'Énumérations', 'Groupes de tables', 'Zones et notes', 'Verrous', 'Commentaires', 'Dérive du schéma', 'Gestion des données', 'Modèles de projet', 'Webhooks du projet', 'Index et clés composites', 'Projets et déclinaisons', 'Comparaison des environnements', 'Détail de version', 'Détail de déploiement', 'Sauvegarde et restauration', 'Compte SQL personnel', 'Privilèges SQL', 'Invitation et accès', 'Règles personnalisées', 'Paramètres DBML', 'Aide et raccourcis'];
const CATALOG = [
  ['Global', 'Accueil', 'home'], ['Global', 'Projets', 'projects'], ['Global', 'Bases', 'bases'], ['Global', 'Requêtes', 'sql'], ['Global', 'Notifications', 'notifications'],
  ...['Schéma', 'Qualité', 'Versions', 'Bases', 'Paramètres', 'Importer', 'Exporter', 'Convertir', 'Comparer', 'Dictionnaire', 'Déployer', 'Historique des déploiements', 'Données initiales', 'Générateur'].map(x => ['Projet', x, 'schema', x]),
  ...['Vue d’ensemble', 'Objets', 'Accès et comptes', 'Comptes SQL', 'Santé', 'Sessions', 'Journal', 'Surveillance', 'Sauvegardes', 'Paramètres'].map(x => ['Base', x, 'bases', x]),
  ...ADM.flatMap(g => g[1]).map(x => ['Administration', x, 'admin', x]),
  ...SET.map(x => ['Compte', x, 'settings', x]),
  ...EXTRA.map(x => ['Parcours', x, 'detail', x]),
  ...AUTH.map(x => ['Authentification', x, 'auth', x]),
  ['Référence', 'Composants et états', 'reference'], ['Référence', 'Catalogue des écrans', 'catalog']
];
const xbtn = (label, action, arg = '', primary = false) => bt(label, { act: action, arg, k: primary ? 'pri' : '' });
const empty = (title, text, action = '') => `<div class="empty-state">${ic('folder', 32)}<h2>${title}</h2><p class="muted">${text}</p>${action}</div>`;
function downloadFile(name, content, type = 'text/plain') {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function routeTo(view, section = '') {
  S.view = view;
  if (view === 'schema') S.tab = section || 'Schéma';
  if (view === 'admin') S.admSec = section || 'Vue d\'ensemble';
  if (view === 'settings') S.setSec = section || 'Profil';
  if (view === 'bases') { S.baseOpen = !!section; S.baseTab = section === 'Vue d’ensemble' ? 'Vue d\'ensemble' : section; }
  S.extra = view === 'auth' || view === 'detail' ? section : '';
  DEMO.state = 'Normal'; hideDrawer(); closeFloaters(); renderNav(); render();
}
function currentSection() { return S.view === 'schema' ? S.tab : S.view === 'admin' ? S.admSec : S.view === 'settings' ? S.setSec : S.view === 'bases' && S.baseOpen ? S.baseTab : ['auth','detail'].includes(S.view) ? S.extra || '' : ''; }
function syncRoute() {
  const section = currentSection(); const hash = '#' + S.view + (section ? '/' + encodeURIComponent(section) : '');
  if (location.hash !== hash) history.pushState(null, '', hash);
  DEMO.route = hash;
}
function readRoute() {
  const [view, encoded] = location.hash.slice(1).split('/'); let section = '';
  try { section = decodeURIComponent(encoded || ''); } catch {}
  if (['home','projects','schema','bases','sql','admin','settings','notifications','detail','auth','catalog','reference'].includes(view)) routeTo(view, section);
}
window.addEventListener('popstate', readRoute);
ACT.route = a => { const [v, s] = a.dataset.arg.split('|'); routeTo(v, s); };
ACT.catalog = () => routeTo('catalog');
ACT.reference = () => routeTo('reference');
ACT.extra = a => routeTo('detail', a.dataset.arg);
ACT.auth = a => routeTo('auth', a.dataset.arg);
ACT.download = a => downloadFile(a.dataset.arg || 'schema.dbml', toDbml());
ACT.retry = () => { DEMO.state = 'Normal'; render(); };
ACT.resetDemo = () => { localStorage.removeItem('nebula-mock-v2'); location.reload(); };

render = function() {
  const v = $('#view');
  if (['auth','detail','catalog','reference'].includes(S.view)) {
    v.innerHTML = ''; v.style.overflow = 'auto';
    ({ auth: authPage, detail: detailPage, catalog: catalogPage, reference: referencePage })[S.view](v);
    $('#crumbs').innerHTML = `<span>NebulaDB</span>${ic('chevr',12)}<b>${esc(S.extra || (S.view === 'catalog' ? 'Catalogue des écrans' : 'Composants et états'))}</b>`;
  } else { originalRender(); crumbs(); }
  renderNav(); applyRole(); enhanceActions(v); applyPageState(v); syncRoute(); persistDemo();
  $$('#nav button').forEach(b => b.setAttribute('aria-label', NAV.find(n => n[0] === b.dataset.nav)?.[1] || b.textContent));
  if ($('#demoState')) $('#demoState').value = DEMO.state;
};
go = v => routeTo(v, v === 'schema' ? S.tab : v === 'admin' ? S.admSec : v === 'settings' ? S.setSec : v === 'bases' && S.baseOpen ? S.baseTab : '');

function persistDemo() {
  try { localStorage.setItem('nebula-mock-v2', JSON.stringify({ theme: S.theme, tables: TABLES, edges: EDGES, comments: COMMENTS, records: DEMO.records, plugins: DEMO.plugins, sqlDrafts: DEMO.sqlDrafts })); } catch {}
}
try {
  const saved = JSON.parse(localStorage.getItem('nebula-mock-v2') || 'null');
  if (saved) {
    for (const k of Object.keys(TABLES)) delete TABLES[k]; Object.assign(TABLES, saved.tables || {});
    EDGES.splice(0, EDGES.length, ...(saved.edges || [])); Object.assign(COMMENTS, saved.comments || {});
    Object.assign(DEMO, { records: saved.records || {}, plugins: saved.plugins || DEMO.plugins, sqlDrafts: saved.sqlDrafts || {} });
    if (saved.theme) setTheme(saved.theme);
  }
} catch {}

function applyRole() {
  const adminNav = $('[data-nav="admin"]'); if (adminNav) adminNav.hidden = DEMO.role !== 'Admin';
  if (['auth','catalog','reference'].includes(S.view)) return;
  if (DEMO.role === 'Lecteur') {
    $$('#view button').forEach(b => {
      if (/^(Déployer|Créer|Ajouter|Supprimer|Enregistrer|Modifier|Importer|Restaurer|Écriture|Lecture seule|Nouveau|Nouvelle|Générer)/.test(b.textContent.trim()) && !b.closest('.prototype-tools')) {
        b.disabled = true; b.title = 'Votre rôle Lecteur autorise la consultation uniquement.';
      }
    });
    $$('#view [contenteditable]').forEach(e => e.contentEditable = 'false');
  }
  if (S.view === 'admin' && DEMO.role !== 'Admin') $('#view').innerHTML = empty('Accès réservé aux administrateurs', 'Votre compte peut consulter les projets et les bases qui lui sont accordés.', xbtn('Retour aux projets', 'route', 'projects'));
}
function applyPageState(v) {
  if (DEMO.state === 'Normal' || ['catalog','reference','auth'].includes(S.view)) return;
  const map = {
    'Vide': ['Aucun élément pour le moment', 'Commencez par créer un élément ou importer des données.'],
    'Aucun résultat': ['Aucun résultat', 'Aucun élément ne correspond à vos filtres. Modifiez votre recherche.'],
    'Erreur': ['Impossible de charger cette page', 'La connexion au serveur a échoué. Vos modifications locales sont conservées.'],
    'Hors ligne': ['Connexion interrompue', 'Les modifications du schéma attendent la reconnexion. Les requêtes et les déploiements sont indisponibles.'],
    'Accès refusé': ['Vous n’avez pas accès à cette ressource', 'Demandez un accès à un administrateur ou choisissez un autre projet.'],
    'Lecture seule': ['Cette ressource est en lecture seule', 'Le propriétaire a verrouillé le schéma. Vous pouvez consulter et exporter le modèle.'],
    'Conflit': ['Une modification concurrente demande votre attention', 'Marc a modifié orders.status pendant votre édition. Comparez les deux valeurs avant de continuer.']
  };
  if (DEMO.state === 'Chargement') { v.innerHTML = `<div class="pad" aria-busy="true" aria-label="Chargement"><h1>Chargement…</h1>${[1,2,3,4,5].map(() => '<div class="skeleton"></div>').join('')}</div>`; return; }
  if (DEMO.state === 'Lecture seule' || DEMO.state === 'Hors ligne') {
    v.insertAdjacentHTML('afterbegin', `<div class="banner warn" role="status">${ic('lock')}<div><b>${map[DEMO.state][0]}</b><div>${map[DEMO.state][1]}</div></div>${xbtn('Revenir à l’état normal','retry')}</div>`);
    $$('button',v).forEach(b => { if (/^(Déployer|Exécuter|Enregistrer|Créer|Ajouter|Supprimer)/.test(b.textContent.trim())) { b.disabled = true; b.title = map[DEMO.state][0]; } }); return;
  }
  const [t, d] = map[DEMO.state]; v.innerHTML = empty(t, d, xbtn(DEMO.state === 'Conflit' ? 'Comparer les versions' : 'Réessayer', DEMO.state === 'Conflit' ? 'route' : 'retry', 'schema|Comparer', true));
}

function catalogPage(v) {
  v.innerHTML = `<div class="pad wide">${heading('Catalogue des écrans', 'La référence navigable de la refonte · ' + CATALOG.length + ' destinations', xbtn('Composants et états', 'reference'))}
    <div class="banner info">${ic('info')}Les données et les opérations de ce prototype sont simulées localement. Chaque écran reprend les composants et parcours de l’app ; les services réels ne sont pas appelés.</div>
    <div class="pg-actions"><input class="in" id="catalogSearch" placeholder="Rechercher un écran, un parcours…" aria-label="Rechercher un écran"><select class="in" id="catalogFamily" aria-label="Famille"><option>Toutes les familles</option>${[...new Set(CATALOG.map(c=>c[0]))].map(f=>`<option>${f}</option>`).join('')}</select></div>
    <div id="catalogGrid" class="catalog-grid"></div></div>`;
  const draw = () => {
    const term = $('#catalogSearch').value.toLocaleLowerCase('fr'); const family = $('#catalogFamily').value;
    const rows = CATALOG.filter(c => c.join(' ').toLocaleLowerCase('fr').includes(term) && (family === 'Toutes les familles' || c[0] === family));
    $('#catalogGrid').innerHTML = rows.map(c => `<button class="screen-card" data-act="route" data-arg="${esc(c[2]+'|'+(c[3] || ''))}"><span class="muted eyebrow">${c[0]}</span><b>${esc(c[1])}</b><code>#${c[2]}${c[3] ? '/' + esc(c[3]) : ''}</code><small class="muted">${esc(PAGE_SOURCES[c[2]] || 'Parcours de référence')} ${ic('chevr',12)}</small></button>`).join('') || empty('Aucun écran trouvé','Essayez un autre terme.');
  }; $('#catalogSearch').oninput = draw; $('#catalogFamily').onchange = draw; draw();
}

function authPage(v) {
  const p = S.extra || 'Connexion';
  const sub = {
    'Connexion': 'Retrouvez vos schémas, vos bases et votre équipe.', 'Mot de passe oublié': 'Recevez un lien pour choisir un nouveau mot de passe.',
    'Double authentification': 'Saisissez le code à 6 chiffres de votre application.', 'Code de secours': 'Utilisez un code de récupération non encore utilisé.',
    'Accepter une invitation': 'Camille, rejoignez l’espace Boutique.', 'Réinitialiser le mot de passe': 'Choisissez un mot de passe pour votre compte.'
  };
  let body = '', submit = '', next = '';
  if (p === 'Connexion') { body = fld('Adresse e-mail','',{ type:'email',ph:'vous@entreprise.fr'}) + fld('Mot de passe','',{type:'password'}) + `<div class="row"><label><input type="checkbox"> Garder ma session ouverte</label><span class="sp"></span>${xbtn('Mot de passe oublié','auth','Mot de passe oublié')}</div>`; submit = 'Se connecter'; next = 'Double authentification'; }
  if (p === 'Mot de passe oublié') { body = fld('Adresse e-mail','',{type:'email',ph:'vous@entreprise.fr'}); submit='Envoyer le lien'; next='E-mail envoyé'; }
  if (p === 'E-mail envoyé') body = `<div class="banner ok">Si un compte correspond à cette adresse, un lien de réinitialisation lui a été envoyé.</div><p class="muted">Le lien est à usage unique. Consultez aussi vos courriers indésirables.</p>${xbtn('Ouvrir le lien de démonstration','auth','Réinitialiser le mot de passe')}`;
  if (p === 'Réinitialiser le mot de passe' || p === 'Accepter une invitation') {
    if (p === 'Accepter une invitation') body = `<div class="banner info">Invitation de Marc Delorme · Éditeur · groupe Data<br>Accès : Boutique recette en écriture, Boutique live en lecture.</div>` + fld('Nom affiché','Camille Roux') + fld('E-mail','camille.roux@boutique.fr',{type:'email',dis:1});
    body += fld('Nouveau mot de passe','',{type:'password',hint:'Au moins 12 caractères pour cette instance.'}) + fld('Confirmer le mot de passe','',{type:'password'}); submit = p === 'Accepter une invitation' ? 'Rejoindre l’espace' : 'Enregistrer le mot de passe'; next = 'Connexion';
  }
  if (p === 'Double authentification' || p === 'Code de secours') { body = fld(p === 'Code de secours' ? 'Code de récupération' : 'Code à 6 chiffres','',{mono:1,ph:p === 'Code de secours' ? 'XXXX-XXXX' : '000000'}) + xbtn(p === 'Code de secours' ? 'Utiliser mon authentificateur' : 'Utiliser un code de secours','auth',p === 'Code de secours' ? 'Double authentification' : 'Code de secours'); submit='Vérifier et continuer'; next='home'; }
  if (p === 'Invitation expirée') body = `<div class="banner warn">Ce lien d’invitation a expiré ou a été révoqué.</div><p>Contactez la personne qui vous a invité pour recevoir un nouveau lien.</p>${xbtn('Retour à la connexion','auth','Connexion')}`;
  if (p === 'Session expirée') body = `<div class="banner warn">Votre session a expiré. Connectez-vous pour reprendre votre travail.</div><p class="muted">Vos brouillons locaux sont conservés.</p>${xbtn('Se reconnecter','auth','Connexion',true)}`;
  v.innerHTML = `<div class="auth-wrap"><div class="auth-story"><div class="brand"><b>A</b>NebulaDB</div><h1>Du modèle<br>à la base.</h1><p>Un espace commun pour concevoir, documenter et faire évoluer vos données.</p><div class="auth-model"><b>customers</b><hr><code>id uuid PK<br>email varchar(255)<br>created_at timestamp</code></div><span class="muted">Instance Boutique · hébergement autonome</span></div><div class="auth-card"><span class="eyebrow muted">VOTRE ESPACE DE TRAVAIL</span><h1>${p}</h1><p class="muted">${sub[p] || ''}</p><form id="authForm">${body}<div id="authError" role="alert"></div>${submit ? `<button class="btn pri auth-submit" type="submit">${submit}${ic('chevr')}</button>` : ''}</form><div class="auth-footer">${p !== 'Connexion' ? xbtn('Retour à la connexion','auth','Connexion') : ''}${xbtn('Explorer la maquette','catalog')}</div></div></div>`;
  const form = $('#authForm'); $$('input:not([disabled]):not([type=checkbox])',form).forEach(i => i.required = true);
  form.onsubmit = e => {
    e.preventDefault(); const password = $$('input[type=password]',form); const error = $('#authError');
    if (password.length === 2 && (password[0].value.length < 12 || password[0].value !== password[1].value)) { error.innerHTML = '<p class="form-error">Les mots de passe doivent correspondre et contenir au moins 12 caractères.</p>'; return; }
    if (p === 'Double authentification' && !/^\d{6}$/.test($$('input',form)[0].value)) { error.innerHTML = '<p class="form-error">Saisissez un code de 6 chiffres.</p>'; return; }
    if (next === 'home') routeTo('home'); else routeTo('auth',next);
  };
}

function pluginPage() {
  const tab = DEMO.pluginTab;
  const tabs = ['Catalogue','Installés','Studio','Journaux'];
  const list = ['Export Prisma','Export TypeScript','Export JSON Schema','Export Mermaid','Règles de nommage Boutique','Audit du schéma'];
  let body = '';
  if (tab === 'Catalogue' || tab === 'Installés') body = `<div class="pg-actions"><input class="in" id="pluginSearch" placeholder="Rechercher un plugin" aria-label="Rechercher un plugin"><select class="in" id="pluginCategory" aria-label="Catégorie"><option>Toutes les catégories</option><option>Export</option><option>Qualité</option></select></div><div class="catalog-grid">${list.filter(n=>tab !== 'Installés' || DEMO.plugins.includes(n)).map((n,i)=>`<article class="card plugin-card" data-category="${n.startsWith('Export') ? 'Export' : 'Qualité'}"><div class="row">${ic('zap',24)}${pl(DEMO.plugins.includes(n)?'Installé':'Disponible',DEMO.plugins.includes(n)?'ok':'info')}</div><h2>${n}</h2><p class="muted">${n.startsWith('Export') ? 'Générer un artefact à partir de votre modèle DBML.' : 'Analyser le schéma et proposer des améliorations.'}</p><div class="hint">v1.${i}.0 · Équipe Nebula · lecture du schéma</div><div class="row wrap" style="margin-top:16px">${xbtn(DEMO.plugins.includes(n)?'Configurer':'Installer','pluginInstall',n,true)}${DEMO.plugins.includes(n)?xbtn('Désinstaller','pluginRemove',n):''}</div></article>`).join('')}</div>`;
  if (tab === 'Studio') body = `<div class="split"><div>${fld('Identifiant','boutique.custom-export',{mono:1})}${fld('Nom','Export personnalisé')}${fld('Code JavaScript', 'nebula.plugin({\n  id: "boutique.custom-export",\n  name: "Export personnalisé",\n  version: "1.0.0",\n  contributions: []\n});',{area:1,mono:1})}<div class="row">${xbtn('Valider le manifeste','pluginValidate')}${xbtn('Enregistrer le plugin','pluginStudio','',true)}</div><div id="studioResult" role="status"></div></div><div>${sect('Contributions','Actions disponibles dans l’app',chips(['Import','Export','Canvas','Éditeur','Générateur']))}${sect('Exécution isolée','Le plugin reçoit les données autorisées par ses permissions.','<p class="muted">Cette maquette valide un manifeste de démonstration ; elle n’exécute pas le JavaScript saisi.</p>')}</div></div>`;
  if (tab === 'Journaux') body = dtable(['Date','Plugin','Niveau','Message'],[['10:42','Export Prisma','ok','Génération terminée · 5 modèles'],['10:40','Audit du schéma','warn','3 recommandations'],['10:38','Export TypeScript','bad','Configuration absente']].map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${pl(r[2],r[2])}</td><td>${r[3]}</td></tr>`));
  return `${heading('Plugins','Catalogue, extensions installées, studio et journaux', xbtn('Importer un manifeste','pluginImport'))}<div class="tabs" role="tablist">${tabs.map(t=>`<button role="tab" aria-selected="${t===tab}" data-act="pluginTab" data-arg="${t}">${t}</button>`).join('')}</div><div style="padding-top:18px">${body}</div>`;
}
ACT.pluginTab = a => { DEMO.pluginTab=a.dataset.arg; render(); };
ACT.pluginInstall = a => {
  const name=a.dataset.arg, installed=DEMO.plugins.includes(name);
  showDrawer({ title: installed?'Configurer '+name:'Installer '+name, sub:'Version 1.0 · Plugin de démonstration', save:installed?'Enregistrer':'Autoriser et installer', body:()=>`<div class="banner info">Ce plugin demande un accès en lecture au schéma. Il ne reçoit aucun mot de passe SQL.</div>${fld('Périmètre','Projet courant',{opts:['Projet courant','Tous mes projets']})}${sw('Disponible dans le menu du projet','',true)}${fld('Préfixe des fichiers','boutique',{mono:1})}`, onSave:()=>{if(!installed) DEMO.plugins.push(name); persistDemo(); setTimeout(render,0);} });
};
ACT.pluginRemove = a => { DEMO.plugins=DEMO.plugins.filter(p=>p!==a.dataset.arg); render(); toast('Plugin désinstallé de la démonstration'); };
ACT.pluginValidate = () => { $('#studioResult').innerHTML='<div class="banner ok">Manifeste de démonstration valide · aucune exécution de code.</div>'; };
ACT.pluginStudio = () => { DEMO.plugins.push('Export personnalisé'); DEMO.pluginTab='Installés'; render(); };
ACT.pluginImport = () => showDrawer({title:'Importer un plugin',save:'Vérifier',body:()=>fld('Manifeste JSON','',{area:1,mono:1}),onSave:d=>{try{const manifest=JSON.parse($('textarea',d).value);if(!manifest.id||!manifest.name)throw Error();DEMO.plugins.push(String(manifest.name));persistDemo();setTimeout(render,0);}catch{ $('.db',d).insertAdjacentHTML('beforeend','<p role="alert" class="form-error">Le JSON doit contenir id et name.</p>');return false;}}});
admBody2 = sec => sec==='Plugins' ? pluginPage() : originalAdminBody(sec);

function detailPage(v) {
  const title=S.extra || 'Relations'; let body='';
  const tableOptions=Object.keys(TABLES);
  const featureRows = (headers,rows)=>dtable(headers,rows.map(r=>`<tr>${r.map(x=>`<td>${x}</td>`).join('')}</tr>`));
  if(title==='Plugins') body=pluginPage();
  if(title==='Relations') body=heading(title,'Clés étrangères, cardinalités et règles de suppression',xbtn('Ajouter une relation','relationForm','',true))+featureRows(['Source','Cible','Cardinalité','Suppression',''],EDGES.map((e,i)=>[`${esc(e[0])}.${esc(e[1])}`,`${esc(e[2])}.${esc(e[3])}`,'N → 1','NO ACTION',xbtn('Modifier','relationForm',i)]));
  if(title==='Énumérations') body=heading(title,'Valeurs partagées par les colonnes du schéma',xbtn('Nouvelle énumération','objectForm','Énumération',true))+featureRows(['Nom','Valeurs','Utilisé par',''],[['order_status','pending · paid · shipped · cancelled','orders.status',xbtn('Modifier','objectForm','Énumération')]]);
  if(title==='Groupes de tables') body=heading(title,'Organisation logique du modèle',xbtn('Nouveau groupe','objectForm','Groupe de tables',true))+featureRows(['Groupe','Tables','Couleur',''],[['Commerce','customers, orders, order_lines',pl('Indigo','pri'),xbtn('Modifier','objectForm','Groupe de tables')],['Catalogue','products',pl('Vert','ok'),xbtn('Modifier','objectForm','Groupe de tables')]]);
  if(title==='Zones et notes') body=heading(title,'Annotations visuelles du canvas',xbtn('Créer une zone','objectForm','Zone',true)+xbtn('Ajouter une note','objectForm','Note'))+`<div class="grid2">${sect('Zone Commerce','3 tables','<div class="banner info">customers · orders · order_lines</div>')}${sect('Note de conception','Marc Delorme', '<div class="banner warn">Séparer les données personnelles avant le prochain déploiement.</div>')}</div>`;
  if(title==='Verrous') body=heading(title,'Protection des tables et revue des propriétaires',xbtn('Verrouiller une table','lockForm','',true))+featureRows(['Table','Propriétaire','Raison','Expiration',''],[['orders','Marc Delorme','Migration des statuts','dans 45 minutes',xbtn('Demander la libération','lockForm','orders')]])+`<p class="hint">Un verrou bloque les modifications de structure. La lecture et les commentaires restent disponibles.</p>`;
  if(title==='Commentaires') body=heading(title,'Conversations attachées aux objets du modèle')+tableOptions.map(n=>sect(n,'Discussion de table',cmtHtml(n)+`<form class="comment-form" data-table="${esc(n)}"><label class="f" for="comment-${esc(n)}">Répondre sur ${esc(n)}</label><textarea id="comment-${esc(n)}" class="in" required placeholder="Écrire un commentaire, mentionner @Marc…"></textarea><button class="btn pri" type="submit">Publier</button></form>`)).join('');
  if(title==='Dérive du schéma') body=heading(title,'Boutique recette · modifications réalisées hors Nebula',xbtn('Comparer au modèle','route','schema|Comparer',true))+featureRows(['Objet','Modèle','Base réelle',''],[['orders.status','order_status','varchar(20)',xbtn('Examiner','driftForm','orders.status')],['products.stock','Absent','integer',xbtn('Examiner','driftForm','products.stock')]])+`<div class="banner warn">La dérive doit être examinée avant un nouveau déploiement.</div>`;
  if(title==='Gestion des données') body=heading('Données de customers','Boutique recette · 3 lignes de démonstration',xbtn('Ajouter une ligne','dataRow','',true)+xbtn('Exporter CSV','dataExport'))+featureRows(['id','name','email',''],(DEMO.records.customers || [['1','Alice Martin','alice@example.test'],['2','Karim Benali','karim@example.test'],['3','Emma Laurent','emma@example.test']]).map((r,i)=>[...r.map(esc),xbtn('Modifier','dataRow',i)+xbtn('Supprimer','dataDelete',i)]));
  if(title==='Modèles de projet') body=heading(title,'Choisissez un point de départ',xbtn('Créer un modèle','objectForm','Modèle de projet'))+`<div class="catalog-grid">${['Boutique e-commerce','SaaS multi-locataire','Gestion de stock'].map((n,i)=>`<article class="card plugin-card"><span class="eyebrow muted">POSTGRESQL · ${[9,12,7][i]} TABLES</span><h2>${n}</h2><p class="muted">Tables, relations et documentation de départ.</p>${xbtn('Utiliser ce modèle','templateUse',n,true)}</article>`).join('')}</div>`;
  if(title==='Webhooks du projet') body=heading(title,'Événements de Boutique en ligne',xbtn('Ajouter un webhook','hookForm','',true))+featureRows(['Destination','Événements','Dernier envoi',''],[['https://ci.example.test/nebula','project.updated · deployment.completed',pl('200 OK','ok'),xbtn('Détails et livraisons','hookForm','CI Boutique')]]);
  if(title==='Index et clés composites') body=heading(title,'Table order_lines · contraintes et performances',xbtn('Ajouter un index','indexForm','',true))+featureRows(['Nom','Colonnes','Type',''],[['pk_order_lines','id','Clé primaire',xbtn('Modifier','indexForm','pk_order_lines')],['uq_order_product','order_id, product_id','Unique composite',xbtn('Modifier','indexForm','uq_order_product')],['idx_product','product_id','Index',xbtn('Modifier','indexForm','idx_product')]])+(DEMO.records.indexes||[]).map(i=>sect(esc(i.name),esc(i.table),pl(esc(i.columns.join(', ')))+' '+pl(esc(i.kind),'pri'))).join('');
  if(title==='Projets et déclinaisons') body=heading(title,'Un modèle racine, plusieurs cibles adaptées',xbtn('Créer une déclinaison','branchForm','',true))+`<div class="pipeline-map"><article class="card"><span class="eyebrow muted">PROJET RACINE</span><h2>Boutique en ligne</h2>${pl('PostgreSQL','pri')}<p class="muted">5 tables · référence du modèle</p>${xbtn('Ouvrir le modèle','route','schema|Schéma')}</article><span class="ar">→</span><article class="card"><span class="eyebrow muted">DÉCLINAISON</span><h2>Boutique mobile</h2>${pl('SQLite','ok')}<p class="muted">Types convertis · 2 écarts locaux</p>${xbtn('Synchroniser depuis la racine','branchSync','',true)}</article></div>`+(DEMO.records.branches||[]).map(b=>sect(esc(b.name),b.engine,pl('Déclinaison','info'))).join('')+sect('Écarts locaux','Conservés pendant la synchronisation',featureRows(['Objet','Racine','Déclinaison'],[['orders.status','order_status','text'],['customers.id','uuid','text']]))+`<div class="banner info">La synchronisation présente un diff avant d’appliquer les changements. Les adaptations de types se règlent par moteur.</div>`;
  if(title==='Comparaison des environnements') body=heading(title,'Comparer les schémas déployés')+`<div class="split">${fld('Environnement source','Boutique recette',{opts:BASES.map(b=>b.n)})}${fld('Environnement cible','Boutique live',{opts:BASES.map(b=>b.n)})}</div>`+featureRows(['Objet','Recette','Production','Résultat'],[['addresses','Présente','Absente',pl('À déployer','warn')],['orders.status','order_status','varchar(20)',pl('Différent','warn')],['customers','Identique','Identique',pl('À jour','ok')]])+`<div class="row" style="margin-top:16px">${xbtn('Préparer le déploiement','route','schema|Déployer',true)}${xbtn('Comparer les modèles','route','schema|Comparer')}</div>`;
  if(title==='Détail de version') body=heading('Version v1.4','Marc Delorme · 5 octobre 2026 · ajout de addresses',xbtn('Comparer à la version actuelle','route','schema|Comparer'))+`<div class="banner info">Aperçu historique en lecture seule. Une restauration crée une nouvelle version.</div>`+featureRows(['Opération','Objet','Détail'],[['Ajout','addresses','4 colonnes, 1 relation'],['Modification','orders.status','varchar → enum']])+codeblk(toDbml(),dbmlHL)+`<div class="row">${xbtn('Restaurer cette version','versionRestore','',true)}${xbtn('Restaurer une seule table','vtable')}</div>`;
  if(title==='Détail de déploiement') body=heading('Déploiement #142','Boutique en ligne → Boutique recette · Élise Arnaud')+`<div class="row wrap">${pl('Réussi','ok')}${pl('18,4 s')}${pl('Sauvegarde préalable : oui')}</div>`+sect('Instructions exécutées','PostgreSQL · transaction',codeblk(MIGRATION,sqlHL))+sect('Résultat','5 instructions exécutées',featureRows(['Instruction','État','Durée'],[['CREATE TYPE order_status',pl('OK','ok'),'41 ms'],['CREATE TABLE addresses',pl('OK','ok'),'88 ms'],['ALTER TABLE orders',pl('OK','ok'),'3,7 s'],['CREATE INDEX',pl('OK','ok'),'14,2 s']]))+xbtn('Revenir aux déploiements','route','schema|Historique des déploiements');
  if(title==='Sauvegarde et restauration') body=heading(title,'Boutique recette · PostgreSQL',xbtn('Créer une sauvegarde','backupForm','',true))+backupsBody(BASES[1])+sect('Portée de la restauration','Choisir les objets à remplacer',fld('Portée','Toute la base',{opts:['Toute la base','Schéma public','Tables sélectionnées']})+chips(Object.keys(TABLES),['customers','orders'])+`<div class="banner warn">Une restauration remplace les objets sélectionnés et leurs données.</div>`+xbtn('Préparer la restauration','restoreForm'));
  if(title==='Compte SQL personnel') body=heading(title,'Votre identité pour Boutique live')+`<div class="banner info">Cette connexion utilise le compte de chaque personne. Nebula conserve le secret chiffré, sans jamais le réafficher.</div>`+fld('Connexion','Boutique live',{opts:BASES.map(b=>b.n)})+fld('Nom du compte SQL','e.arnaud',{mono:1})+fld('Mot de passe','',{type:'password',hint:'Laissez vide pour conserver le secret existant.'})+`<div class="row">${xbtn('Tester le compte','sqlAccountTest')}${xbtn('Enregistrer','sqlAccountSave','',true)}${xbtn('Oublier ce compte','sqlAccountForget')}</div><div id="accountResult" role="status"></div>`;
  if(title==='Privilèges SQL') body=heading(title,'Boutique recette · compte m.delorme',xbtn('Créer un rôle','roleForm','',true))+fld('Compte ou rôle','m.delorme',{opts:['m.delorme','i.charp','lecture_seule','ecriture_donnees']})+featureRows(['Objet','SELECT','INSERT','UPDATE','DELETE'],Object.keys(TABLES).map(n=>[n,...['SELECT','INSERT','UPDATE','DELETE'].map(p=>`<label><input type="checkbox" ${p==='SELECT'?'checked':''} aria-label="${p} sur ${n}"> ${p}</label>`)]))+`<div class="banner info">Les privilèges de colonne sont affichables, mais ne sont pas attribuables dans l’interface actuelle.</div>`+xbtn('Prévisualiser les GRANT / REVOKE','privilegePreview','',true);
  if(title==='Invitation et accès') body=heading(title,'Inviter une personne avec tous ses accès',xbtn('Envoyer l’invitation','invitePreview','',true))+`<div class="split"><div>${fld('E-mail','',{type:'email',ph:'prenom@entreprise.fr'})}${fld('Rôle Nebula','Éditeur',{opts:['Admin','Éditeur','Lecteur']})}${chips(['Direction','Data','Support','Finance'],['Data'])}</div><div>${sect('Base et compte SQL','Appliqués à l’acceptation',fld('Base','Boutique recette',{opts:BASES.map(b=>b.n)})+fld('Accès','Lecture',{opts:['Aucun','Lecture','Écriture de données']})+sw('Créer un compte SQL','Son mot de passe est généré à l’acceptation.',true)+fld('Nom du compte SQL proposé','camille.roux',{mono:1}))}</div></div>`;
  if(title==='Règles personnalisées') body=heading(title,'Qualité du modèle · profil personnalisé',xbtn('Ajouter une règle','lintRuleForm','',true))+fld('Motif de nommage des tables','^[a-z][a-z0-9_]*$',{mono:1})+fld('Motif de nommage des colonnes','^[a-z][a-z0-9_]*$',{mono:1})+featureRows(['Règle','Gravité','Active'],[['Clé primaire obligatoire',pl('Erreur','bad'),sw('Clé primaire','',true)],['Index sur une clé étrangère',pl('Avertissement','warn'),sw('Index FK','',true)],['Description de table',pl('Information','info'),sw('Description','',false)]])+fld('Règles JSON','{\n  "tableNamePattern": "^[a-z][a-z0-9_]*$",\n  "requirePrimaryKey": true\n}',{area:1,mono:1})+`<div class="row">${xbtn('Vérifier le JSON','lintValidate')}${xbtn('Enregistrer le profil','localSave','',true)}</div><div id="lintResult" role="status"></div>`;
  if(title==='Paramètres DBML') body=heading(title,'Édition du code et synchronisation avec le canvas',xbtn('Enregistrer','localSave','',true))+`<div class="split"><div>${fld('Délai de synchronisation','500 ms',{opts:['Immédiat','300 ms','500 ms','1 seconde']})}${fld('Indentation','2 espaces',{opts:['2 espaces','4 espaces','Tabulation']})}${fld('Taille du texte','13 px',{opts:['12 px','13 px','14 px','16 px']})}${sw('Synchroniser pendant la saisie','Uniquement quand le DBML est valide.',true)}</div><div>${sw('Complétion automatique','Tables, colonnes, types et mots-clés.',true)}${sw('Formater à l’enregistrement','Conserver les commentaires.',true)}${sw('Afficher les numéros de ligne','',true)}${sw('Mettre en évidence la sélection sur le canvas','',true)}${sw('Minicarte du code','',false)}</div></div>`;
  if(title==='Aide et raccourcis') body=originalSettingsBody('Raccourcis et aide');
  v.innerHTML=`<div class="pad wide">${xbtn('Retour au schéma','route','schema|Schéma')}<div style="margin-top:16px">${body}</div></div>`;
  $$('.comment-form',v).forEach(f=>f.onsubmit=e=>{e.preventDefault();const n=f.dataset.table;(COMMENTS[n] ||= []).push({a:'Élise Arnaud',t:$('textarea',f).value,w:'à l’instant'});persistDemo();render();});
}
ACT.relationForm = a => {
  const index=a.dataset.arg === '' ? -1 : Number(a.dataset.arg), e=EDGES[index] || [Object.keys(TABLES)[0],'id',Object.keys(TABLES)[1],'id'];
  showDrawer({title:index<0?'Nouvelle relation':'Modifier la relation',save:'Enregistrer la relation',body:()=>fld('Table source',e[0],{opts:Object.keys(TABLES)})+fld('Colonne source',e[1])+fld('Table cible',e[2],{opts:Object.keys(TABLES)})+fld('Colonne cible',e[3])+fld('Cardinalité','N → 1',{opts:['N → 1','1 → 1','N → N']})+fld('ON DELETE','NO ACTION',{opts:['NO ACTION','CASCADE','SET NULL','RESTRICT']})+fld('ON UPDATE','NO ACTION',{opts:['NO ACTION','CASCADE','SET NULL','RESTRICT']}),onSave:d=>{const val=$$('.in',d).map(i=>i.value);if(!TABLES[val[0]].cols.some(c=>c[0]===val[1])||!TABLES[val[2]].cols.some(c=>c[0]===val[3])){$('.db',d).insertAdjacentHTML('beforeend','<p class="form-error" role="alert">Sélectionnez des colonnes présentes dans les deux tables.</p>');return false;}if(index<0)EDGES.push(val.slice(0,4));else EDGES[index]=val.slice(0,4);persistDemo();setTimeout(render,0);}});
};
ACT.objectForm = a => showDrawer({title:a.dataset.arg,save:'Enregistrer',body:()=>fld('Nom','',{ph:'Nom de l’objet'})+fld('Description','',{area:1})+(a.dataset.arg==='Énumération'?fld('Valeurs (une par ligne)','pending\npaid\nshipped\ncancelled',{area:1,mono:1}):fld('Tables incluses',Object.keys(TABLES).join(', '))),onSave:d=>{const name=$('input',d).value.trim();if(!name){$('input',d).required=true;$('input',d).reportValidity();return false;}(DEMO.records.objects ||= []).push({type:a.dataset.arg,name});persistDemo();setTimeout(render,0);}});
ACT.lockForm = a => showDrawer({title:'Verrou de table',save:'Appliquer le verrou',body:()=>fld('Table',a.dataset.arg||'orders',{opts:Object.keys(TABLES)})+fld('Motif','Migration en cours',{area:1})+fld('Expiration','1 heure',{opts:['15 minutes','1 heure','1 jour','Sans expiration']}),onSave:d=>{TABLES[$('select',d).value].lock=true;persistDemo();}});
ACT.driftForm = a => showDrawer({title:'Écart : '+a.dataset.arg,save:'Appliquer la décision',body:()=>`<div class="banner warn">Comparez le modèle et la base avant de choisir la référence.</div>`+fld('Résolution','Mettre à jour le modèle',{opts:['Mettre à jour le modèle','Préparer une migration de la base','Ignorer cet écart']})+fld('Commentaire de décision','',{area:1})});
ACT.templateUse = a => showDrawer({title:'Créer depuis '+a.dataset.arg,save:'Créer le projet',body:()=>fld('Nom du projet',a.dataset.arg)+fld('Description','',{area:1}),onSave:()=>setTimeout(()=>routeTo('schema','Schéma'),0)});
ACT.hookForm = a => showDrawer({title:a.dataset.arg||'Webhook du projet',tabs:['Configuration','Livraisons'],save:'Enregistrer',body:t=>t==='Configuration'?fld('Nom','CI Boutique')+fld('URL HTTPS','https://ci.example.test/nebula',{type:'url'})+chips(['project.updated','deployment.completed','deployment.failed'],['project.updated','deployment.completed'])+fld('Secret de signature','',{type:'password'}):dtable(['Heure','Statut','Durée','Tentative'],['10:42|200 OK|142 ms|1','10:40|503|3 s|3'].map(r=>'<tr>'+r.split('|').map(s=>`<td>${s}</td>`).join('')+'</tr>'))});
function dataRows(){return DEMO.records.customers ||= [['1','Alice Martin','alice@example.test'],['2','Karim Benali','karim@example.test'],['3','Emma Laurent','emma@example.test']];}
ACT.dataRow = a => {const idx=a.dataset.arg===''?-1:Number(a.dataset.arg),row=dataRows()[idx]||[String(dataRows().length+1),'',''];showDrawer({title:idx<0?'Ajouter une ligne':'Modifier une ligne',save:'Valider les données',body:()=>fld('id',row[0],{mono:1})+fld('name',row[1])+fld('email',row[2],{type:'email'}),onSave:d=>{const row=$$('input',d).map(i=>i.value);if(idx<0)dataRows().push(row);else dataRows()[idx]=row;persistDemo();setTimeout(render,0);}});};
ACT.dataDelete = a => {const idx=Number(a.dataset.arg),old=dataRows().splice(idx,1)[0];render();toast('Ligne supprimée',()=>{dataRows().splice(idx,0,old);render();});};
ACT.dataExport = () => downloadFile('customers.csv','id,name,email\n'+dataRows().map(r=>r.map(x=>'"'+String(x).replaceAll('"','""')+'"').join(',')).join('\n'),'text/csv');

ACT.indexForm = a => showDrawer({title:a.dataset.arg?'Modifier '+a.dataset.arg:'Nouvel index',save:'Enregistrer l’index',body:()=>fld('Table','order_lines',{opts:Object.keys(TABLES)})+fld('Nom',a.dataset.arg||'idx_order_lines_product',{mono:1})+fld('Colonnes (séparées par une virgule)','order_id, product_id',{mono:1})+fld('Type','Unique composite',{opts:['Index','Unique composite','Clé primaire composite']})+fld('Méthode','btree',{opts:['btree','hash']})+fld('Commentaire','',{area:1}),onSave:d=>{const val=$$('.in',d).map(i=>i.value),cols=val[2].split(',').map(s=>s.trim());if(!val[1]||cols.some(n=>!TABLES[val[0]].cols.some(c=>c[0]===n))){$('.db',d).insertAdjacentHTML('beforeend','<p class="form-error" role="alert">Choisissez un nom et des colonnes existantes.</p>');return false;}(DEMO.records.indexes ||= []).push({table:val[0],name:val[1],columns:cols,kind:val[3]});persistDemo();setTimeout(render,0);}});
ACT.branchForm = () => showDrawer({title:'Nouvelle déclinaison',save:'Créer la déclinaison',body:()=>fld('Projet racine','Boutique en ligne')+fld('Nom','Boutique mobile')+fld('Moteur cible','SQLite',{opts:['PostgreSQL','MySQL','SQL Server','Oracle','SQLite']})+sw('Convertir les types automatiquement','Le résultat sera présenté avant la création.',true),onSave:d=>{const val=$$('.in',d).map(i=>i.value);(DEMO.records.branches ||= []).push({name:val[1],engine:val[2]});persistDemo();setTimeout(render,0);}});
ACT.branchSync = () => showDrawer({title:'Synchroniser la déclinaison',save:'Appliquer les changements',body:()=>'<div class="banner info">1 table ajoutée · 2 adaptations locales conservées.</div>'+fld('Conflits de types','Conserver les adaptations locales',{opts:['Conserver les adaptations locales','Utiliser la conversion depuis la racine']})+codeblk('Table addresses {\n  id text [pk]\n  customer_id text\n  city text\n  zip text\n}',dbmlHL)});
ACT.versionRestore = () => confirmDlg({title:'Restaurer v1.4 ?',text:'Le modèle revient à cet état. La restauration crée une nouvelle version et conserve l’historique.',ok:'Restaurer',danger:false,done:'Restauration de modèle simulée'});
ACT.backupForm = () => showDrawer({title:'Créer une sauvegarde',save:'Lancer la sauvegarde',body:()=>fld('Base','Boutique recette',{opts:BASES.map(b=>b.n)})+fld('Portée','Toute la base',{opts:['Toute la base','Schéma public','Tables sélectionnées']})+chips(Object.keys(TABLES),Object.keys(TABLES))+fld('Nom de la sauvegarde','avant-migration-2026-10-05',{mono:1})});
ACT.restoreForm = () => showDrawer({title:'Préparer la restauration',save:'Continuer',body:()=>fld('Sauvegarde','5 octobre 2026 · 02:00')+fld('Base cible','Boutique recette',{opts:BASES.map(b=>b.n)})+sw('Sauvegarder l’état actuel avant restauration','Activé par défaut.',true)+fld('Portée','Toute la base',{opts:['Toute la base','Tables sélectionnées']}),onSave:d=>{const target=$('select',d).value;setTimeout(()=>confirmDlg({title:'Restaurer '+target+' ?',text:'Les objets sélectionnés sont remplacés par la sauvegarde. Une copie de l’état actuel est prise avant.',typed:target,ok:'Restaurer',done:'Restauration simulée'}),0);}});
ACT.sqlAccountTest = () => $('#accountResult').innerHTML='<div class="banner ok">Test simulé réussi · accès lecture et écriture sur public.</div>';
ACT.sqlAccountSave = () => {$('#accountResult').innerHTML='<div class="banner ok">Compte configuré pour cette démonstration. Aucun mot de passe n’est conservé.</div>';};
ACT.sqlAccountForget = () => confirmDlg({title:'Oublier ce compte ?',text:'Le secret n’est plus utilisé par Nebula. Le compte dans la base n’est pas supprimé.',ok:'Oublier le compte',done:'Suppression simulée'});
ACT.roleForm = () => showDrawer({title:'Créer un rôle SQL',save:'Préparer la création',body:()=>fld('Nom du rôle','lecture_analytique',{mono:1})+sw('Autoriser la connexion','Un rôle de groupe n’en a pas besoin.',false)+fld('Rôles hérités','lecture_seule',{mono:1})});
ACT.privilegePreview = () => {const rows=$$('tbody tr').map(r=>{const n=$('td',r).textContent;const priv=$$('input:checked',r).map(i=>i.getAttribute('aria-label').split(' ')[0]);return priv.length?`GRANT ${priv.join(', ')} ON TABLE public.${n} TO "m.delorme";`:`REVOKE ALL ON TABLE public.${n} FROM "m.delorme";`;});showDrawer({title:'Instructions de privilèges',save:'Appliquer',body:()=>'<div class="banner warn">Vérifiez ces changements avant de les appliquer à la base.</div>'+codeblk(rows.join('\n'),sqlHL)});};
ACT.invitePreview = () => {const email=$('input[type=email]');email.required=true;if(!email.reportValidity())return;showDrawer({title:'Récapitulatif de l’invitation',save:'Envoyer l’invitation',body:()=>`<p><b>${esc(email.value)}</b></p><p>Rôle : ${esc($('select').value)}. Les groupes et accès choisis seront attribués lors de l’acceptation.</p><div class="banner info">Envoi simulé : aucun e-mail ne sera envoyé.</div>`});};
ACT.lintRuleForm = () => showDrawer({title:'Règle personnalisée',save:'Enregistrer',body:()=>fld('Identifiant','custom.table-prefix',{mono:1})+fld('Description','Les tables commencent par un préfixe')+fld('Cible','Tables',{opts:['Tables','Colonnes','Relations','Index']})+fld('Gravité','Avertissement',{opts:['Erreur','Avertissement','Information']})+fld('Motif regex','^app_',{mono:1})});
ACT.lintValidate = () => {try{JSON.parse($('textarea').value);$('#lintResult').innerHTML='<div class="banner ok">JSON valide.</div>';}catch{$('#lintResult').innerHTML='<div class="banner bad">JSON invalide : vérifiez les guillemets, virgules et accolades.</div>';}};
ACT.localSave = () => {persistDemo();toast('Configuration simulée enregistrée');};

function referencePage(v) {
  v.innerHTML=`<div class="pad wide">${heading('Composants et états','Contrat visuel du front · tokens conservés depuis la maquette originale',xbtn('Catalogue des écrans','catalog'))}
    ${sect('Couleurs sémantiques','Même signification en clair et en sombre',`<div class="token-grid">${['bg','s1','s2','s3','primary','text','muted','ok','warn','bad','info'].map(t=>`<div class="token"><span style="background:var(--${t})"></span><code>--${t}</code></div>`).join('')}</div>`)}
    ${sect('Boutons','Primaire : une action principale par contexte ; danger : action destructive',`<div class="row wrap">${xbtn('Action principale','reference','',true)}${xbtn('Action secondaire','reference')}<button class="btn bad">Supprimer</button><button class="btn" disabled title="Accès insuffisant">Indisponible</button></div>`)}
    ${sect('Statuts','Le texte et l’icône complètent la couleur',`<div class="row wrap">${pl('Réussi','ok')}${pl('À examiner','warn')}${pl('Échec','bad')}${pl('Information','info')}${pl('Verrouillé','lock')}${pl('En cours','pri')}</div>`)}
    ${sect('Formulaires','Labels visibles, validation inline, valeur préservée en cas d’erreur',`<div class="grid2">${fld('Nom du projet','Boutique en ligne')}${fld('Connexion','Boutique recette',{opts:['Boutique recette','Boutique live']})}${fld('Mot de passe','',{type:'password',hint:'Jamais réaffiché après enregistrement.'})}<div>${fld('Nom obligatoire','',{ph:'Saisissez un nom'})}<p class="form-error" role="alert">Le nom est obligatoire.</p></div></div>${sw('Recevoir les notifications','Mention, déploiement et alerte',true)}`)}
    ${sect('États de page','À explorer avec le sélecteur de la barre Prototype',`<div class="row wrap">${['Normal','Chargement','Vide','Aucun résultat','Erreur','Hors ligne','Accès refusé','Lecture seule','Conflit'].map(s=>pl(s)).join('')}</div>`)}
    ${sect('Règles de mise en page','Coque, navigation et détails',`<p>Barre supérieure : 48 px · barre latérale : 216 px · inspecteur : 320 px · grille d’espacement : 4 / 8 / 12 / 16 / 24 / 32 px.</p><p>Une seule rangée d’onglets. Les détails s’ouvrent dans un panneau latéral. Une confirmation centrale est réservée aux décisions irréversibles.</p><p>IBM Plex Sans pour l’interface, IBM Plex Mono pour le code. Focus visible, labels associés, tableaux défilants et actions accessibles au clavier.</p>`)}
    ${sect('Contrat d’implémentation','Les interactions locales illustrent le comportement attendu',`<p>Remplacer les données fictives par les hooks et API existants ; conserver les permissions serveur. Les exports DBML/CSV/JSON et les opérations locales du prototype fonctionnent sans service. Les fonctions de base de données, l’envoi d’e-mails, le TOTP et les déploiements restent simulés.</p>`)}
  </div>`;
}

function enhanceActions(v) {
  if(S.view==='detail') {
    const objects=DEMO.records.objects || [];
    const relevant=objects.filter(o=>({'Énumérations':'Énumération','Groupes de tables':'Groupe de tables','Zones et notes':'Zone','Modèles de projet':'Modèle de projet'})[S.extra]===o.type || (S.extra==='Zones et notes'&&o.type==='Note'));
    if(relevant.length) $('.pad',v).insertAdjacentHTML('beforeend',sect('Éléments ajoutés','Enregistrés dans ce navigateur',relevant.map(o=>`<div class="card" style="padding:12px;margin-top:8px"><b>${esc(o.name)}</b> ${pl(o.type)}</div>`).join('')));
  }
  const ps=$('#pluginSearch',v); if(ps) {
    const filter=()=>$$('.plugin-card',v).forEach(c=>c.hidden=!c.textContent.toLowerCase().includes(ps.value.toLowerCase())||($('#pluginCategory').value!=='Toutes les catégories'&&c.dataset.category!==$('#pluginCategory').value));
    ps.oninput=filter; $('#pluginCategory').onchange=filter;
  }
  if(S.view==='projects'||(S.view==='admin'&&S.admSec==='Utilisateurs')) {
    const search=$('input[placeholder*="Recherch"],input[placeholder*="Filtrer"]',v);
    if(search) search.oninput=()=>$$('tbody tr',v).forEach(r=>r.hidden=!r.textContent.toLocaleLowerCase('fr').includes(search.value.toLocaleLowerCase('fr')));
  }
  if(S.view==='schema'&&S.tab==='Schéma') {
    const dock=document.createElement('div');dock.className='object-access';dock.innerHTML=`<button class="btn sm" data-act="extra" data-arg="Relations">${ic('link',14)} Relations</button><button class="btn sm" data-act="extra" data-arg="Commentaires">${ic('note',14)} Discussions</button><button class="btn sm" data-act="extra" data-arg="Verrous">${ic('lock',14)} Verrous</button><button class="btn sm" data-act="projectObjects" aria-haspopup="menu">${ic('more',14)} Objets</button>`;v.appendChild(dock);
  }
  const contextual = S.view==='schema' ? ({'Bases':['Comparaison des environnements','Dérive du schéma','Sauvegarde et restauration'],'Paramètres':['Projets et déclinaisons','Webhooks du projet'],'Qualité':['Règles personnalisées'],'Versions':['Détail de version'],'Historique des déploiements':['Détail de déploiement']})[S.tab] : S.view==='settings' ? ({'Éditeur':['Paramètres DBML'],'Mes comptes SQL':['Compte SQL personnel']})[S.setSec] : S.view==='admin' ? ({'Invitations':['Invitation et accès'],'Comptes SQL':['Privilèges SQL'],'Modèles de projet':['Modèles de projet']})[S.admSec] : null;
  if(contextual){const pad=$('.pad',v);if(pad)pad.insertAdjacentHTML('beforeend',`<div class="row wrap contextual-actions">${contextual.map(t=>xbtn(t,'extra',t)).join('')}</div>`);}
  if(S.view==='schema'&&S.tab==='Importer') enhanceImport(v);
  if(S.view==='schema'&&S.tab==='Exporter') enhanceExport(v);
  if(S.view==='bases') $$('button',v).forEach(b=>{
    const t=b.textContent.trim();
    if(t==='Données')b.onclick=()=>routeTo('detail','Gestion des données');
    if(t==='Structure')b.onclick=()=>routeTo('detail','Index et clés composites');
    if(t==='Ouvrir dans Requêtes')b.onclick=()=>routeTo('sql');
    if(t==='Sauvegarder maintenant')b.onclick=()=>ACT.backupForm();
  });
  if(S.view==='sql') enhanceSql(v);
  if(S.view==='settings'&&S.setSec==='Sécurité') enhanceSecurity(v);
  $$('button',v).forEach(b=>{
    if(b.onclick || b.dataset.act || b.closest('form') || b.classList.contains('sw2') || b.closest('.seg,.tabs,.chipset'))return;
    const t=b.textContent.trim();
    if(t==='Nouvel environnement') b.onclick=()=>simpleForm('Nouvel environnement',['Nom','Couleur','Confirmation avant déploiement']);
    if(t==='Créer le compte'||t==='Privilèges') b.onclick=()=>simpleForm('Compte SQL',['Compte','Rôle','Schéma autorisé']);
    if(t==='Mot de passe') b.onclick=()=>simpleForm('Modifier le mot de passe SQL',['Nouveau mot de passe','Confirmer le mot de passe']);
    if(t==='Acquitter') b.onclick=()=>{b.closest('tr').remove();toast('Alerte acquittée');};
    if(t==='Mettre en sourdine') b.onclick=()=>simpleForm('Mettre en sourdine',['Durée','Motif']);
    if(t==='Copier le lien') b.onclick=()=>copyDemo(location.href.split('#')[0]+'#auth/Accepter%20une%20invitation');
    if(t==='Renvoyer') b.onclick=()=>toast('Nouvel envoi simulé · invitation en attente');
    if(t==='Révoquer') b.onclick=()=>{b.closest('tr').remove();toast('Invitation révoquée dans la démonstration');};
    if(t==='Enregistrer'||t==='Enregistrer les modifications') b.onclick=()=>{persistDemo();toast('Modifications enregistrées dans ce navigateur');};
    if(t==='Nouveau modèle') b.onclick=()=>ACT.objectForm({dataset:{arg:'Modèle de projet'}});
  });
  const me=$('#meBtn'); me.onclick=e=>popMenu(e.currentTarget,[['lab','Élise Arnaud · '+DEMO.role],['cog','Mon compte','',()=>routeTo('settings','Profil')],['key','Sécurité','',()=>routeTo('settings','Sécurité')],['x','Se déconnecter','',()=>routeTo('auth','Connexion')]],true);
}
function enhanceImport(v) {
  let input=$('textarea',v);
  const drop=$('.drop',v);
  if(drop){
    const file=document.createElement('input');file.type='file';file.accept='.dbml,.sql';file.hidden=true;drop.appendChild(file);
    const browse=$('button',drop);browse.onclick=()=>file.click();
    const load=async f=>{if(!f)return;if(f.size>10*1024*1024){toast('Le fichier dépasse 10 Mo.');return;}DEMO.importCode=await f.text();drop.insertAdjacentHTML('beforeend',`<div class="banner info">${esc(f.name)} · ${Math.round(f.size/1024)} Ko · prêt à importer</div>`);};
    file.onchange=()=>load(file.files[0]);drop.ondragover=e=>e.preventDefault();drop.ondrop=e=>{e.preventDefault();load(e.dataTransfer.files[0]);};
  }
  const button=$$('button',v).find(b=>b.textContent.trim()==='Importer');
  if(button){button.removeAttribute('data-act');button.onclick=()=>{
    const code=input?input.value:DEMO.importCode;
    if(!code){showDrawer({title:'Aperçu de l’import',save:'Confirmer l’import simulé',body:()=>'<div class="banner info">Sélectionnez un fichier ou collez du DBML pour importer réellement dans le prototype. Les connexions et modèles de départ présentent un aperçu simulé.</div>'+codeblk(toDbml(),dbmlHL)});return;}
    try{
      if(!/^\s*(?:\/\/[^\n]*\n\s*)*Table\s/m.test(code)){showDrawer({title:'Import SQL',foot:false,body:()=>'<div class="banner info">La conversion SQL vers DBML est assurée par le moteur de l’app. Dans ce prototype autonome, utilisez un fichier DBML pour appliquer un import local.</div>'});return;}
      const parsed=parseDbml(code);
      const names=Object.keys(parsed.tables);if(!names.length)throw Error('Aucune table détectée');
      showDrawer({title:'Aperçu de l’import DBML',save:'Importer '+names.length+' table(s)',body:()=>`<p>${names.map(n=>pl(esc(n),'info')).join(' ')}</p><div class="banner warn">Les tables de même nom seront mises à jour. Les autres tables sont conservées.</div>`+codeblk(code,dbmlHL),onSave:()=>{for(const [n,t]of Object.entries(parsed.tables)){TABLES[n]={x:TABLES[n]?.x||30,y:TABLES[n]?.y||50,color:TABLES[n]?.color||'var(--d2)',cols:t.cols};}EDGES.push(...parsed.edges.filter(e=>!EDGES.some(old=>old.join('.')===e.join('.'))));persistDemo();setTimeout(()=>routeTo('schema','Schéma'),0);}});
    }catch(e){showDrawer({title:'Erreur de syntaxe DBML',foot:false,body:()=>`<p class="form-error" role="alert">${e.line ? 'Ligne '+e.line+' : ' : ''}${esc(e.message || e.msg || 'Syntaxe invalide')}</p><p>Corrigez le code puis relancez l’import.</p>`});}
  };}
}
function enhanceExport(v) {
  const format=S.exp?.fmt||'DBML';const text=format.startsWith('SQL')?Object.keys(TABLES).map(n=>convertDdl(ddl(n),format.replace('SQL ',''))).join('\n\n'):toDbml();
  $$('button',v).forEach(b=>{
    if(b.textContent.trim()==='Copier'){b.removeAttribute('data-act');b.onclick=()=>copyDemo(text);}
    if(b.textContent.trim()==='Télécharger'){
      b.removeAttribute('data-act');b.onclick=()=>{
        if(format==='DBML'||format.startsWith('SQL'))downloadFile(format==='DBML'?'boutique.dbml':'boutique.sql',text);
        else if(format==='SVG')downloadFile('boutique.svg',diagramSvg(),'image/svg+xml');
        else showDrawer({title:'Exporter en '+format,foot:false,body:()=>`<p>Le rendu ${format} sera généré par l’exporteur du canvas dans l’application.</p><div class="banner info">Cette version autonome fournit l’export vectoriel SVG, ainsi que DBML et SQL.</div>`+xbtn('Télécharger le SVG','diagramDownload')});
      };
    }
  });
}
function diagramSvg(){const cards=Object.entries(TABLES).map(([n,t],i)=>{const x=(i%3)*260+20,y=Math.floor(i/3)*260+20;return `<g transform="translate(${x} ${y})"><rect width="230" height="${40+t.cols.length*26}" rx="8" fill="#fbfaf7" stroke="#837e73"/><text x="14" y="25" font-weight="bold">${esc(n)}</text>${t.cols.map((c,j)=>`<text x="14" y="${54+j*26}" font-size="12">${esc(c[0])} : ${esc(c[1])}</text>`).join('')}</g>`;}).join('');return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${Math.ceil(Object.keys(TABLES).length/3)*260}" font-family="monospace" fill="#1f1e1b">${cards}</svg>`;}
ACT.diagramDownload=()=>downloadFile('boutique.svg',diagramSvg(),'image/svg+xml');
ACT.projectObjects=a=>popMenu(a,[...['Index et clés composites','Énumérations','Groupes de tables','Zones et notes','Projets et déclinaisons','Paramètres DBML'].map(t=>['tbl',t,'',()=>routeTo('detail',t)])]);
function simpleForm(title,fields){showDrawer({title,save:'Enregistrer',body:()=>fields.map(f=>fld(f,'',{type:f.includes('mot de passe')?'password':'text'})).join('')});}
async function copyDemo(value){try{await navigator.clipboard.writeText(value);toast('Copié');}catch{showDrawer({title:'Copier le texte',foot:false,body:()=>fld('Texte à copier',value,{area:1,mono:1})});}}

function enhanceSql(v) {
  const pre=$('.ed pre',v);if(pre){
    const code=DEMO.sqlDrafts[S.sqlTab] ?? pre.textContent;
    const textarea=document.createElement('textarea');textarea.className='sql-input';textarea.setAttribute('aria-label','Éditeur de requête SQL');textarea.spellcheck=false;textarea.value=code;pre.replaceWith(textarea);
    textarea.oninput=()=>{DEMO.sqlDrafts[S.sqlTab]=textarea.value;persistDemo();};
    $('#fmt').onclick=()=>{textarea.value=textarea.value.replace(/\b(select|from|where|join|on|order by|group by|limit|update|set|delete|insert into|values)\b/gi,x=>x.toUpperCase()).replace(/\s+(FROM|WHERE|ORDER BY|GROUP BY|LIMIT)\b/g,'\n$1');DEMO.sqlDrafts[S.sqlTab]=textarea.value;persistDemo();};
    $('#run').onclick=()=>{
      if(DEMO.role==='Lecteur'&&/\b(UPDATE|DELETE|INSERT|DROP|ALTER|CREATE)\b/i.test(textarea.value)){toast('Votre rôle autorise les requêtes de lecture uniquement.');return;}
      if(/\b(UPDATE|DELETE|INSERT)\b/i.test(textarea.value)&&!S.sqlWrite){toast('Activez le mode écriture avant cette instruction.');return;}
      if(/\b(DROP|ALTER|CREATE)\b/i.test(textarea.value)){showDrawer({title:'Modification de structure',foot:false,body:()=>'<p>Les changements de structure se préparent dans le modèle et se déploient avec une migration.</p>'+xbtn('Ouvrir le schéma','route','schema|Schéma',true)});return;}
      S.ran=true;render();
    };
    const newq=$('[data-newq]');if(newq)newq.onclick=()=>{QUERIES2.push({n:'Requête '+(QUERIES2.length+1),code:'SELECT * FROM customers LIMIT 100;'});S.sqlTab=QUERIES2.length-1;S.ran=false;render();};
  }
  const ex=$('#exp');if(ex)ex.onclick=e=>popMenu(e.currentTarget,[['file','CSV','',()=>ACT.dataExport()],['file','JSON','',()=>downloadFile('resultats.json',JSON.stringify(dataRows().map(r=>({id:r[0],name:r[1],email:r[2]})),null,2),'application/json')],['copy','Copier','',()=>copyDemo(dataRows().map(r=>r.join('\t')).join('\n'))]]);
}

function enhanceSecurity(v) {
  v.insertAdjacentHTML('beforeend',`<div class="pad">${sect('Parcours de double authentification','Configurer, récupérer et révoquer l’accès',xbtn('Configurer un authentificateur','mfaSetup','',true)+xbtn('Afficher les codes de secours','backupCodes')+xbtn('Désactiver la 2FA','mfaDisable'))}</div>`);
}
ACT.mfaSetup = () => {
  const steps=['Installer','Associer','Vérifier'];
  const show=()=>showDrawer({title:'Configurer la double authentification',save:DEMO.mfaStep===2?'Activer':'Continuer',body:()=>stepper(steps,DEMO.mfaStep+1)+(DEMO.mfaStep===0?'<p>Ouvrez votre application d’authentification et ajoutez un compte TOTP.</p><div class="banner info">Parcours de démonstration : aucun secret réel n’est généré.</div>':DEMO.mfaStep===1?'<div class="totp-placeholder">Emplacement du QR code TOTP</div>'+fld('Clé manuelle de démonstration','DEMO ONLY — NOT A VALID SECRET',{mono:1}):fld('Code à 6 chiffres','',{mono:1,ph:'000000'})),onSave:d=>{if(DEMO.mfaStep<2){DEMO.mfaStep++;setTimeout(show,0);return true;}if(!/^\d{6}$/.test($('input',d).value)){$('.db',d).insertAdjacentHTML('beforeend','<p class="form-error" role="alert">Un code de 6 chiffres est requis.</p>');return false;}DEMO.mfaStep=0;setTimeout(()=>ACT.backupCodes(),0);}});show();
};
ACT.backupCodes = () => showDrawer({title:'Codes de récupération',foot:false,body:()=>'<div class="banner warn">Exemples de démonstration, inutilisables pour se connecter. Chaque code réel n’est utilisable qu’une fois.</div><pre class="codeblk">DEMO-0001  DEMO-0002\nDEMO-0003  DEMO-0004\nDEMO-0005  DEMO-0006\nDEMO-0007  DEMO-0008</pre>'+xbtn('Télécharger les exemples','codesDownload')+xbtn('Régénérer','codesRegenerate')});
ACT.codesDownload = () => downloadFile('nebula-codes-DEMO.txt','EXEMPLES — NON VALIDES\n'+Array.from({length:8},(_,i)=>'DEMO-000'+(i+1)).join('\n'));
ACT.codesRegenerate = () => confirmDlg({title:'Régénérer les codes ?',text:'Les anciens codes ne fonctionneront plus. Conservez les nouveaux dans un endroit sûr.',ok:'Régénérer',danger:false,done:'Régénération simulée'});
ACT.mfaDisable = () => showDrawer({title:'Désactiver la double authentification',save:'Désactiver',body:()=>'<div class="banner warn">Votre compte sera protégé uniquement par votre mot de passe.</div>'+fld('Mot de passe actuel','',{type:'password'})+fld('Code d’authentification','',{mono:1})});

const oldShowDrawer = showDrawer;
showDrawer = function(cfg, tab) {
  const focused=document.activeElement;oldShowDrawer(cfg,tab);
  const d=$('#drw');if(!d)return;d.setAttribute('role','dialog');d.setAttribute('aria-modal','false');d.tabIndex=-1;
  const focusable=()=>$$('button:not(:disabled),input:not(:disabled),select,textarea,[tabindex="0"]',d);
  const list=focusable();(list.find(e=>e.tagName==='INPUT'||e.tagName==='TEXTAREA')||list[0]||d).focus();
  d.addEventListener('keydown',e=>{if(e.key==='Escape'){hideDrawer();focused?.focus();}if(e.key==='Tab'){const l=focusable();if(e.shiftKey&&document.activeElement===l[0]){e.preventDefault();l.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===l.at(-1)){e.preventDefault();l[0]?.focus();}}});
};

const originalDrawInsp=drawInsp;
drawInsp=function(){
  originalDrawInsp();const pane=$('#insp'),t=TABLES[S.sel];if(!pane||!t)return;
  const col=S.selCol&&t.cols.find(c=>c[0]===S.selCol);
  const update=()=>{persistDemo();drawTables();drawInsp();if(S.dbml)renderDbml();};
  const rename=$('#tn',pane);if(rename)rename.onchange=()=>{
    const before=S.sel,after=rename.value.trim();if(!/^[a-zA-Z_]\w*$/.test(after)||TABLES[after]){toast('Nom invalide ou déjà utilisé');rename.value=before;return;}
    TABLES[after]=t;delete TABLES[before];EDGES.forEach(e=>{if(e[0]===before)e[0]=after;if(e[2]===before)e[2]=after;});if(COMMENTS[before]){COMMENTS[after]=COMMENTS[before];delete COMMENTS[before];}S.sel=after;update();
  };
  if(col){
    const props=col[3] ||= {};
    $('#cn',pane).onchange=e=>{const name=e.target.value.trim();if(!/^[a-zA-Z_]\w*$/.test(name)||t.cols.some(c=>c!==col&&c[0]===name)){toast('Nom de colonne invalide ou déjà utilisé');e.target.value=col[0];return;}const old=col[0];col[0]=name;EDGES.forEach(r=>{if(r[0]===S.sel&&r[1]===old)r[1]=name;if(r[2]===S.sel&&r[3]===old)r[3]=name;});S.selCol=name;update();};
    $('#ct',pane).onchange=e=>{col[1]=e.target.value.trim()||'text';update();};
    for(const [id,key]of [['cd','default'],['cm','note']]){const input=$('#'+id,pane);input.value=props[key]||'';input.onchange=()=>{props[key]=input.value;persistDemo();};}
    $$('.pill',pane).filter(p=>['Clé primaire','Unique'].includes(p.textContent)).forEach(p=>{const button=document.createElement('button');button.className=p.className;button.textContent=p.textContent;button.setAttribute('aria-pressed',col[2]===(p.textContent==='Clé primaire'?'pk':'uq'));button.onclick=()=>{const flag=p.textContent==='Clé primaire'?'pk':'uq';col[2]=col[2]===flag?'':flag;update();};p.replaceWith(button);});
    $$('.sw2',pane).forEach(s=>{const key=s.getAttribute('aria-label')==='Non nul'?'notNull':'indexed';if(props[key]!==undefined)s.setAttribute('aria-checked',props[key]);s.addEventListener('click',()=>{props[key]=s.getAttribute('aria-checked')!=='true';persistDemo();});});
  }
  $$('button',pane).forEach(b=>{if(b.textContent.includes('Ajouter un index'))b.onclick=()=>ACT.indexForm({dataset:{arg:''}});});
  if(DEMO.role==='Lecteur'||DEMO.state==='Lecture seule')$$('input,button:not(#closeInsp)',pane).forEach(e=>{e.disabled=true;e.title='Consultation uniquement';});
};
const originalToDbml=toDbml;
toDbml=function(){
  let code=originalToDbml();
  for(const [name,t]of Object.entries(TABLES)){
    const block=`Table ${name} {\n`+t.cols.map(c=>{const props=c[3]||{},at=[];if(c[2]==='pk')at.push('pk');if(c[2]==='uq')at.push('unique');if(props.notNull)at.push('not null');if(props.default)at.push('default: `'+props.default.replaceAll('`','')+'`');if(props.note)at.push("note: '"+props.note.replaceAll("'","\\'")+"'");return `  ${c[0]} ${c[1]}${at.length?' ['+at.join(', ')+']':''}`;}).join('\n')+
      ((DEMO.records.indexes||[]).some(i=>i.table===name)?'\n\n  indexes {\n'+DEMO.records.indexes.filter(i=>i.table===name).map(i=>`    (${i.columns.join(', ')}) [${i.kind==='Clé primaire composite'?'pk, ':i.kind==='Unique composite'?'unique, ':''}name: '${i.name}']`).join('\n')+'\n  }':'')+'\n}';
    code=code.replace(new RegExp('Table '+name+' \\{[\\s\\S]*?\\n\\}'),()=>block);
  }
  return code;
};
const originalParseDbml=parseDbml;
parseDbml=function(code){
  /* Le parseur léger du prototype ne gère pas les blocs Indexes du moteur réel. */
  return originalParseDbml(code.replace(/\n\s*indexes\s*\{[\s\S]*?\n\s*\}/gi,''));
};

const proto=document.createElement('div');proto.className='prototype-tools';proto.innerHTML=`<span class="prototype-label">${ic('eye',14)} Prototype</span><button class="btn sm" data-act="catalog">Écrans <span class="mono">${CATALOG.length}</span></button><button class="btn sm" data-act="reference">Composants</button><label>Rôle <select id="demoRole" aria-label="Rôle simulé"><option>Admin</option><option>Éditeur</option><option>Lecteur</option></select></label><label>État <select id="demoState" aria-label="État de page simulé">${['Normal','Chargement','Vide','Aucun résultat','Erreur','Hors ligne','Accès refusé','Lecture seule','Conflit'].map(s=>`<option>${s}</option>`).join('')}</select></label><span class="sp"></span><span class="hint prototype-hint">Données fictives · changements locaux</span><button class="btn sm" data-act="resetDemo">Réinitialiser</button>`;
document.body.appendChild(proto);
$('#demoRole').onchange=e=>{DEMO.role=e.target.value;S.sqlWrite=false;render();};
$('#demoState').onchange=e=>{DEMO.state=e.target.value;render();};
document.addEventListener('click',()=>setTimeout(persistDemo,0));
document.documentElement.lang='fr';document.title='NebulaDB — Maquette complète';
readRoute();render();
