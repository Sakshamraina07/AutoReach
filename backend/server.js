import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

// ✅ Catch unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRASH] Unhandled Rejection:', JSON.stringify(reason, null, 2));
});

const app = express();
app.set('trust proxy', 1); // ✅ Fix for express-rate-limit on Render
app.use(cors());
app.use(express.json());

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
export const supabase = createClient(supabaseUrl, supabaseKey);

// Import Routes
import userRoutes from './routes/user.js';
import hrRoutes from './routes/hr.js';
import emailRoutes from './routes/email.js';
import resumeRoutes from './routes/resume.js';
import trackRoutes from './routes/track.js';
import settingsRoutes from './routes/settings.js';

app.use('/user', userRoutes);
app.use('/hr', hrRoutes);
app.use('/email', emailRoutes);
app.use('/resume', resumeRoutes);
app.use('/track', trackRoutes);
app.use('/settings', settingsRoutes);

// Health Check
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'AutoReach API is running' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);

    // Initialize Workers
    import('./workers/queueWorker.js');
    import('./workers/followupWorker.js');
});