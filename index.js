const express = require('express');
const { Client, MessageMedia } = require('whatsapp-web.js');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const bodyParser = require('body-parser');
require('dotenv').config(); // Load environment variables from .env file
const PORT = process.env.PORT || 5001;
const app = express();
app.use(bodyParser.json());

// MongoDB connection using environment variable
const mongoURI = process.env.MONGODB_URI;

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('MongoDB connected!'))
    .catch(err => console.error('MongoDB connection error:', err));

// Define a schema and model
const userSchema = new mongoose.Schema({
    phone: String,
    session: Object,
});

const User = mongoose.model('User', userSchema);

// WhatsApp client initialization
const client = new Client({
    puppeteer: {
        headless: true, // Run in headless mode for production
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    },
    session: null // Start with no session
});

let currentQRCodeUrl = ''; // Variable to hold the current QR code URL

// Check for existing session on startup
const initializeClient = async () => {
    const user = await User.findOne(); // Get the first user in the database
    if (user && user.session) {
        client.session = user.session; // Set the session if available
    }
    client.initialize(); // Start the client
};

// Generate QR code and save session data
client.on('qr', (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
        if (err) {
            console.error('Error generating QR code:', err);
            return;
        }
        currentQRCodeUrl = url; // Store the QR code URL
        console.log('QR Code generated:', url);
    });
});

// Save session and handle ready event
client.on('ready', async () => {
    console.log('Client is ready!');
    // Optional: Store the session in the database
    const sessionData = client.info;
    const user = await User.findOneAndUpdate(
        { phone: sessionData.wid.user },
        { session: sessionData },
        { upsert: true, new: true }
    );

    // Log the user's _id
    console.log('User ID:', user._id);
});

// Error handling
client.on('auth_failure', (msg) => {
    console.error('Authentication failure:', msg);
});

// Logout endpoint
app.post('/logout', async (req, res) => {
    try {
        await client.destroy(); // Logout the current client
        await User.deleteMany(); // Clear user data from MongoDB
        res.send('Logged out and user data cleared.');
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).send('Logout failed.');
    }
});

// Get QR code endpoint
app.get('/qr-code', (req, res) => {
    if (currentQRCodeUrl) {
        res.json({ qrCodeUrl: currentQRCodeUrl });
    } else {
        res.status(404).send('QR code not available yet.');
    }
});

// Send text message endpoint
app.post('/send-message', async (req, res) => {
    const { id, number, message } = req.body; // Get id (token) from request
    if (!id || !number || !message) {
        return res.status(400).send('ID, number, and message are required.');
    }

    try {
        // Find the user by id
        const user = await User.findById(id);
        if (!user) {
            return res.status(404).send('User not found.');
        }

        // Send message using the WhatsApp client
        await client.sendMessage(`${number}@c.us`, message);
        res.send('Message sent successfully!');
    } catch (error) {
        console.error('Failed to send message:', error);
        res.status(500).send('Failed to send message.');
    }
});

// Send photo message endpoint
app.post('/send-photo', async (req, res) => {
    const { id, number, imageUrl, caption } = req.body; // Get id (token) from request

    if (!id || !number || !imageUrl) {
        return res.status(400).send('ID, number, and imageUrl are required.');
    }

    try {
        // Find the user by id
        const user = await User.findById(id);
        if (!user) {
            return res.status(404).send('User not found.');
        }

        // Sending photo message with unsafeMime set to true
        const media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
        await client.sendMessage(`${number}@c.us`, media, { caption: caption || '' });
        res.send('Photo message sent successfully!');
    } catch (error) {
        console.error('Failed to send photo:', error);
        res.status(500).send('Failed to send photo message.');
    }
});

// Start the client and server
initializeClient(); // Initialize the client with session if available

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
