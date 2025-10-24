import express from "express";
import http from "http";
import dotenv from "dotenv";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { connectDB } from "./config/db.js";
import { initSocket } from "./socket.js";
import { getAdminTables, forceEndTable } from "./socket.js";
import User from "./models/User.js";

dotenv.config();
const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://poker-texas-holdem.netlify.app', 'https://www.poker-texas-holdem.netlify.app']
        : '*',
    methods: ['GET', 'POST'],
    credentials: true
}));
app.use(express.json());

// Port configuration
const PORT = process.env.PORT || 3000;

// Base de données
connectDB();

// Fallback in-memory user store for development when MongoDB isn't configured
const inMemoryUsers = new Map();
function isDbConnected() {
    return mongoose.connection && mongoose.connection.readyState === 1;
}

// Admin credentials (dev fallback). In production set ADMIN_USER and ADMIN_PASS in env.
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'adminpass';

// Middleware d'authentification
const auth = async (req, res, next) => {
    try {
        const token = req.header("Authorization").replace("Bearer ", "");
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findOne({ _id: decoded.id });

        if (!user) {
            throw new Error();
        }

        req.user = user;
        next();
    } catch (error) {
        res.status(401).send({ error: "Veuillez vous authentifier." });
    }
};

// Routes d'authentification
app.post("/api/auth/register", async (req, res) => {
    try {
        const { username, email, password } = req.body;
        console.log('POST /api/auth/register attempt', { username, email, dbConnected: isDbConnected() });
        
        // If DB is connected, use MongoDB. Otherwise use in-memory fallback (dev).
        if (isDbConnected()) {
            // Vérification si l'utilisateur existe déjà
            const existingUser = await User.findOne({ $or: [{ username }, { email }] });
            if (existingUser) {
                return res.status(400).send({ error: "Utilisateur déjà existant" });
            }

            // Création du nouvel utilisateur
            const user = new User({
                username,
                email,
                password: await bcrypt.hash(password, 10),
                chips: 1000 // Jetons de départ
            });

            await user.save();
            
            // Génération du token
            const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
                expiresIn: "7d"
            });

            res.status(201).send({ user, token });
        } else {
            // In-memory fallback
            if (!username || !email || !password) return res.status(400).send({ error: 'Missing fields' });
            const exists = Array.from(inMemoryUsers.values()).find(u => u.username === username || u.email === email);
            if (exists) return res.status(400).send({ error: 'Utilisateur déjà existant (mode dev)' });

            const id = `local_${Date.now()}_${Math.floor(Math.random()*10000)}`;
            const hashed = await bcrypt.hash(password, 10);
            const user = { _id: id, id, username, email, password: hashed, chips: 1000 };
            inMemoryUsers.set(id, user);
            const token = jwt.sign({ id }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '7d' });
            const safeUser = { ...user }; delete safeUser.password;
            res.status(201).send({ user: safeUser, token });
        }
    } catch (error) {
        res.status(400).send({ error: error.message });
    }
});

app.post("/api/auth/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log('POST /api/auth/login attempt', { username, dbConnected: isDbConnected() });
        if (isDbConnected()) {
            // Recherche de l'utilisateur
            const user = await User.findOne({ username });
            if (!user) {
                return res.status(401).send({ error: "Identifiants incorrects" });
            }

            // Vérification du mot de passe
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(401).send({ error: "Identifiants incorrects" });
            }

            // Génération du token
            const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
                expiresIn: "7d"
            });

            res.send({ user, token });
        } else {
            // In-memory fallback
            const user = Array.from(inMemoryUsers.values()).find(u => u.username === username);
            if (!user) return res.status(401).send({ error: 'Identifiants incorrects (mode dev)' });
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) return res.status(401).send({ error: 'Identifiants incorrects (mode dev)' });
            const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '7d' });
            const safeUser = { ...user }; delete safeUser.password;
            res.send({ user: safeUser, token });
        }
    } catch (error) {
        res.status(400).send({ error: error.message });
    }
});

// Routes protégées
app.get("/api/profile", auth, async (req, res) => {
    // If DB not connected and token is for local user, return from in-memory store
    if (!isDbConnected() && req.user && req.user.id && inMemoryUsers.has(req.user.id)) {
        const u = inMemoryUsers.get(req.user.id);
        const safe = { ...u }; delete safe.password;
        return res.send(safe);
    }
    res.send(req.user);
});

app.patch("/api/profile", auth, async (req, res) => {
    const updates = Object.keys(req.body);
    const allowedUpdates = ["username", "email", "password"];
    const isValidOperation = updates.every(update => allowedUpdates.includes(update));

    if (!isValidOperation) {
        return res.status(400).send({ error: "Mises à jour invalides" });
    }

    try {
        updates.forEach(update => {
            if (update === "password") {
                req.user[update] = bcrypt.hashSync(req.body[update], 10);
            } else {
                req.user[update] = req.body[update];
            }
        });

        await req.user.save();
        res.send(req.user);
    } catch (error) {
        res.status(400).send({ error: error.message });
    }
});

// Initialisation des sockets
const io = initSocket(server);
server.listen(PORT, () => {
    console.log(`
🃏 Serveur de poker démarré!
🌐 http://localhost:${PORT}
✨ Mode: ${process.env.NODE_ENV || "development"}
    `);
});

// Global error handlers to avoid process crash on unexpected errors
process.on('uncaughtException', (err) => {
    console.error('uncaughtException:', err && (err.stack || err.message));
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('unhandledRejection at:', promise, 'reason:', reason && (reason.stack || reason));
});

// Dev-only: list users (DB or in-memory)
app.get('/api/dev/users', async (req, res) => {
    try {
        if (isDbConnected()) {
            const users = await User.find().select('-password');
            return res.send({ source: 'db', users });
        }
        const users = Array.from(inMemoryUsers.values()).map(u => { const s = { ...u }; delete s.password; return s; });
        return res.send({ source: 'memory', users });
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

// Dev-only: seed in-memory users (useful when MongoDB is not running)
app.post('/api/dev/seed-memory', async (req, res) => {
    try {
        // create a default user if none exists
        if (inMemoryUsers.size === 0) {
            const bcrypt = await import('bcrypt');
            const hashed = await bcrypt.default.hash('password123', 10);
            const id = `local_${Date.now()}_${Math.floor(Math.random()*10000)}`;
            const user = { _id: id, id, username: 'mathieu', email: 'mathieu@example.com', password: hashed, chips: 1000 };
            inMemoryUsers.set(id, user);
            return res.send({ ok: true, user: { ...user, password: undefined } });
        }
        const users = Array.from(inMemoryUsers.values()).map(u => { const s = { ...u }; delete s.password; return s; });
        res.send({ ok: true, users });
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

// Admin login (supports DB-based admin user or env fallback)
app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        console.log('POST /api/admin/login attempt', { username, dbConnected: isDbConnected() });
        // If DB connected, prefer finding an admin user in DB
        if (isDbConnected()) {
            const adminUser = await User.findOne({ username, isAdmin: true });
            if (adminUser) {
                const isMatch = await bcrypt.compare(password, adminUser.password);
                if (isMatch) {
                    const token = jwt.sign({ id: adminUser._id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '7d' });
                    return res.send({ token, user: { id: adminUser._id, username: adminUser.username } });
                }
            }
        }

        // Fallback to env-based admin
        if (username === ADMIN_USER && password === ADMIN_PASS) {
            const token = jwt.sign({ id: 'admin_local', role: 'admin' }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '7d' });
            return res.send({ token, user: { id: 'admin_local', username: ADMIN_USER } });
        }

        return res.status(401).send({ error: 'Identifiants admin invalides' });
    } catch (err) {
        return res.status(500).send({ error: err.message });
    }
});

// Middleware to protect admin routes
async function adminAuth(req, res, next) {
    try {
        const header = req.header('Authorization');
        if (!header) return res.status(401).send({ error: 'Veuillez vous authentifier.' });
        const token = header.replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');

        // Token with explicit admin role
        if (decoded && decoded.role === 'admin') {
            req.admin = decoded;
            return next();
        }

        // Otherwise, check DB user for isAdmin flag
        if (decoded && decoded.id && isDbConnected()) {
            const u = await User.findById(decoded.id);
            if (u && u.isAdmin) {
                req.admin = u;
                return next();
            }
        }

        return res.status(403).send({ error: 'Accès administrateur requis.' });
    } catch (err) {
        return res.status(401).send({ error: 'Veuillez vous authentifier.' });
    }
}

// Admin endpoints: list users, delete user, basic stats
app.get('/api/admin/users', adminAuth, async (req, res) => {
    try {
        if (isDbConnected()) {
            const users = await User.find().select('-password');
            return res.send({ source: 'db', users });
        }
        const users = Array.from(inMemoryUsers.values()).map(u => { const s = { ...u }; delete s.password; return s; });
        return res.send({ source: 'memory', users });
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

app.delete('/api/admin/users/:id', adminAuth, async (req, res) => {
    try {
        const id = req.params.id;
        if (isDbConnected()) {
            await User.deleteOne({ _id: id });
            return res.send({ ok: true });
        }
        if (inMemoryUsers.has(id)) {
            inMemoryUsers.delete(id);
            return res.send({ ok: true });
        }
        return res.status(404).send({ error: 'Utilisateur introuvable' });
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

// Admin: get active tables
app.get('/api/admin/tables', adminAuth, async (req, res) => {
    try {
        const t = getAdminTables();
        res.send({ tables: t });
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

// Admin: force end table
app.post('/api/admin/tables/:id/force-end', adminAuth, async (req, res) => {
    try {
        const tableId = req.params.id;
        const ok = forceEndTable(io, tableId);
        if (!ok) return res.status(404).send({ error: 'Table introuvable' });
        res.send({ ok: true });
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});