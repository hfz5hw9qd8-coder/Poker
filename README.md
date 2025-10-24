# Poker - Déploiement

Ce dépôt contient un backend Node/Express et un frontend statique (dans `frontend/public`) pour un jeu de Poker en ligne avec Socket.IO.

## Prérequis locaux
- Node.js (LTS) installé
- npm
- MongoDB local (optionnel pour dev) ou MongoDB Atlas pour la production

## Lancer en local
1. Copier `.env.example` en `.env` et remplir les valeurs :

```
PORT=5000
MONGO_URI=mongodb://localhost:27017/poker
JWT_SECRET=change_me
NODE_ENV=development
```

2. Installer les dépendances et lancer le serveur (depuis la racine) :

```bash
npm install
npm run dev
```

Le serveur écoute par défaut sur `http://localhost:5000`.

## Utiliser MongoDB Atlas (rapide)
1. Créez un compte sur https://www.mongodb.com/cloud/atlas
2. Créez un cluster gratuit (Shared Cluster)
3. Créez un utilisateur de base de données (user/password)
4. Dans Network Access, ajoutez votre IP (ou `0.0.0.0/0` temporairement)
5. Récupérez la chaîne de connexion et collez-la comme `MONGO_URI` dans `.env` (remplacez `<password>`)

Exemple :
```
MONGO_URI=mongodb+srv://<user>:<password>@cluster0.abcd.mongodb.net/poker?retryWrites=true&w=majority
```

## Pousser sur GitHub
1. Initialiser git si besoin :

```bash
git init
git add .
git commit -m "Initial commit"
# créer un repo GitHub puis :
git remote add origin git@github.com:<votre-compte>/poker.git
git push -u origin main
```

## Déploiement recommandé (Render)
Render est simple pour déployer une app Node avec une base de données externe.

1. Créez un compte sur https://render.com
2. Connectez votre repo GitHub
3. Ajoutez un nouveau "Web Service" -> branche `main`
4. Build Command: laissez vide (pas de build pour frontend statique) ou `npm install`
5. Start Command: `npm start`
6. Dans les Environment Variables, ajoutez :
   - `MONGO_URI` (votre chaîne Atlas)
   - `JWT_SECRET` (une valeur aléatoire)
   - `NODE_ENV=production`
7. Déployez et surveillez les logs

## Déploiement alternatif (Heroku)
1. Créez une app sur Heroku
2. Déployez via GitHub ou Heroku CLI
3. Dans Settings > Config Vars, ajoutez vos variables d'environnement
4. Procfile non nécessaire si `start` est configuré dans package.json

## Vérifications post-déploiement
- Ouvrez l'URL publique fournie par le service
- Testez inscription / connexion
- Vérifiez que la connexion WebSocket est établie (console navigateur)

## Notes de sécurité
- Ne commitez jamais `.env` contenant des secrets
- Utilisez un JWT_SECRET fort
- En production, restreignez l'accès réseau à votre cluster MongoDB

## Fichiers importants
- `backend/server.js` - point d'entrée
- `backend/socket.js` - logique Socket.IO et tables
- `frontend/public` - fichiers statiques (HTML/CSS/JS)

---
Si vous voulez, je peux :
- créer le repo GitHub pour vous (si vous me fournissez le nom),
- vous guider étape par étape pour créer le cluster Atlas,
- configurer un déploiement automatique sur Render.
