import express from 'express';
import { supabase } from '../server.js';

const router = express.Router();

// Public endpoint for email open tracking
router.get('/:history_id', async (req, res) => {
    try {
        const { history_id } = req.params;

        // Base64 encoded 1x1 transparent GIF
        const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
        
        // Return pixel immediately so email client doesn't hang
        res.writeHead(200, {
            'Content-Type': 'image/gif',
            'Content-Length': pixel.length,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        res.end(pixel);

        // Update database asynchronously
        if (history_id && history_id.length === 36) { // basic UUID check
            await supabase
                .from('email_history')
                .update({ 
                    opened_at: new Date().toISOString() 
                })
                .eq('id', history_id)
                .is('opened_at', null); // Only update if it hasn't been opened yet
        }
    } catch (error) {
        console.error('Tracking Error:', error);
    }
});

export default router;
