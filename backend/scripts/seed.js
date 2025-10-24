import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import User from '../models/User.js';

dotenv.config();

async function main() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/poker';
  await mongoose.connect(uri);
  console.log('Connected to', uri);

  await User.deleteMany({});
  const password = await bcrypt.hash('password123', 10);
  const u = new User({ username: 'mathieu', email: 'mathieu@example.com', password, chips: 1000 });
  await u.save();
  console.log('Seeded user:', u.username);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
