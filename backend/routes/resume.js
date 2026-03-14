import express from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { supabase, supabaseAdmin } from '../server.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/upload', requireAuth, upload.single('resume'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const fileExt = req.file.originalname.split('.').pop();
        const fileName = `${req.user.id}-${Date.now()}.${fileExt}`;
        const filePath = `${fileName}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('resumes')
            .upload(filePath, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: true
            });

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
            .from('resumes')
            .getPublicUrl(filePath);

        // ✅ FIXED: Update user_metadata instead of .from('users')
        const { error: dbError } = await supabaseAdmin.auth.admin.updateUserById(
            req.user.id,
            { user_metadata: { resume_url: publicUrl } }
        );

        if (dbError) throw dbError;

        res.json({ success: true, resume_url: publicUrl });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;