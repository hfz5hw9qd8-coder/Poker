#!/usr/bin/env node
import fetch from 'node-fetch';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../backend/models/User.js';

dotenv.config();

async function fromMongo() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/poker';
  try {
    await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    const users = await User.find().select('-password').lean();
    console.log(JSON.stringify({ source: 'mongo', users }, null, 2));
    await mongoose.disconnect();
    return true;
  } catch (err) {
    console.error('Mongo error:', err.message || err);
    return false;
  }
}

async function fromEndpoint() {
  const url = process.env.BACKEND_URL || 'http://localhost:5000/api/dev/users';
  try {
    const res = await fetch(url, { method: 'GET' });
    const json = await res.json();
    console.log(JSON.stringify(json, null, 2));
    return true;
  } catch (err) {
    console.error('Endpoint error:', err.message || err);
    return false;
  }
}

(async function main(){
  // Try Mongo first
  const ok = await fromMongo();
  if (!ok) {
    await fromEndpoint();
  }
  process.exit(0);
})();
