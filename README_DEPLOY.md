# Déploiement — Frontend & Backend (gratuit / tutoriel)

Ceci décrit comment héberger gratuitement le frontend statique et le backend Node (socket.io).

Résumé recommandé :
- Frontend (static): Netlify / Vercel / GitHub Pages
- Backend (socket.io): Fly.io (petit plan gratuit) ou Render / Railway pour prototypage

Prérequis (sur WSL/Windows) :
- git
- Node.js (pour installer netlify/vercel CLI si nécessaire)
- flyctl (si tu choisis Fly.io)

-------------------------
1) Préparer le dépôt (si tu n'as pas encore de repo Git)

cd "C:\Users\mathieu\Desktop\poker"
git init
git add .
git commit -m "Initial commit"

Créer un repo GitHub puis :
git remote add origin https://github.com/TON_USER/TON_REPO.git
git push -u origin main

-------------------------
2) Déployer le frontend (dossier `frontend/public`)

Option A — Netlify (recommandé pour simplicité)
- Crée un compte sur https://app.netlify.com
- Connecte GitHub et sélectionne ton repo (déploiement automatique à chaque push)

Option B — Vercel
- Installe Vercel CLI (facultatif) : `npm i -g vercel`
- Depuis `frontend/public` : `vercel` et suis les instructions

Option C — GitHub Pages (si pur statique)
- Place le contenu de `frontend/public` à la racine d'un repo ou dans `gh-pages` branch
- Utilise `gh-pages` npm package ou active GitHub Pages dans les Settings

-------------------------
3) Déployer le backend (serveur Node/socket.io)

Option recommandée : Fly.io

Installation (suivre https://fly.io/docs/getting-started/installing/)
Sur WSL :
curl -L https://fly.io/install.sh | sh

Déployer :
cd backend
flyctl launch --name poker-backend --region ams || flyctl init
# Si asked, choisis "Deploy with Dockerfile" ou accepte les valeurs par défaut
flyctl deploy

Notes :
- Le Dockerfile est fourni dans `backend/Dockerfile`.
- Si ton serveur écoute sur une autre variable d'environnement ou port, ajuste `ENV PORT` et `server.js`.

Alternatives gratuites/protoype : Render / Railway / Replit
- Render: créer un "Web Service", connecter repo, build command `npm install` et start `node server.js`.
- Railway: plus simple pour prototypes (peut dormir si inactif)

-------------------------
4) Connexion frontend ↔ backend
- Si le frontend utilise `io()` sans URL, il tente d'atteindre la même origine. Sur Netlify/Vercel, tu peux configurer une variable d'environnement ou éditer `client.js` pour `io('https://TON_BACKEND_URL')`.

Exemple rapide : dans `frontend/public/client.js`, trouver la connexion socket et remplacer par :
const socket = io('https://your-backend.fly.dev');

-------------------------
5) DNS / nom de domaine (optionnel)
- Netlify/Vercel offrent des domaines gratuits `*.netlify.app` ou `*.vercel.app`.
- Pour un domaine personnalisé, ajoute un enregistrement CNAME vers l'hôte fourni.

-------------------------
Commandes utiles (WSL)

cd "C:/Users/mathieu/Desktop/poker/frontend/public"
npx serve -l 3000        # pour test local

cd "C:/Users/mathieu/Desktop/poker/backend"
docker build -t poker-backend .
docker run -p 3000:3000 poker-backend

-------------------------
Si tu veux, je peux :
- (A) te guider pas à pas pour déployer le frontend sur Netlify (je fournis les commandes exactes),
- (B) déployer le backend sur Fly.io (je peux exécuter `flyctl launch` et `flyctl deploy` si tu me donnes l'autorisation et que `flyctl` est installé),
- (C) créer un script de déploiement automatisé.

Dis-moi quelle option tu veux que je réalise maintenant (Netlify / Vercel / GitHub Pages pour frontend, Fly.io / Render pour backend). 
