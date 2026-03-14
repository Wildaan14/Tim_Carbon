const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files from the 'client' directory
const clientPath = path.join(__dirname, '../../client');
app.use(express.static(clientPath));

// --- API Routes ---
// Placeholder API route for future use (e.g., getting data status or triggering python scripts)
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        message: 'CarbonGIS Backend API is running.',
        timestamp: new Date().toISOString()
    });
});

// For any other route, send back the index.html file to let frontend routing handle it (if applicable)
// Even though this is currently a single-page app without complex routing, this is standard practice.
// Catch-all route handled by static middleware for index.html as a fallback
app.get('/', (req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Serving frontend from: ${clientPath}`);
});
