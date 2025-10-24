import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.log('No MongoDB URI provided — running with in-memory fallback');
    return;
  }

  try {
    await mongoose.connect(uri, {
      // useNewUrlParser/useUnifiedTopology are defaults in modern mongoose
      // keep options explicit for clarity
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err && (err.stack || err.message || err));
  }
}

export default connectDB;
