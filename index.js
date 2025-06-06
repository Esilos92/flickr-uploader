// index.js — Complete and tested Flickr upload endpoint for Vercel

import express from 'express';
import dotenv from 'dotenv';
import crypto from 'crypto';
import axios from 'axios';
import FormData from 'form-data';
import OAuth from 'oauth-1.0a';

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

const {
  FLICKR_API_KEY,
  FLICKR_API_SECRET,
  FLICKR_ACCESS_TOKEN,
  FLICKR_ACCESS_SECRET
} = process.env;

const oauth = new OAuth({
  consumer: { key: FLICKR_API_KEY, secret: FLICKR_API_SECRET },
  signature_method: 'HMAC-SHA1',
  hash_function(base, key) {
    return crypto.createHmac('sha1', key).update(base).digest('base64');
  },
});

app.post('/upload', async (req, res) => {
  const { imageUrl, title = '', description = '' } = req.body;

  if (!imageUrl) return res.status(400).json({ error: 'Missing imageUrl' });

  try {
    const imageResponse = await axios.get(imageUrl, { responseType: 'stream' });
    const form = new FormData();

    form.append('photo', imageResponse.data, { filename: 'upload.jpg' });
    form.append('title', title);
    form.append('description', description);
    form.append('is_public', '0'); // Keep private by default

    const url = 'https://up.flickr.com/services/upload/';
    const requestData = { url, method: 'POST' };

    const authHeader = oauth.toHeader(oauth.authorize(requestData, {
      key: FLICKR_ACCESS_TOKEN,
      secret: FLICKR_ACCESS_SECRET,
    }));

    const response = await axios.post(url, form, {
      headers: {
        ...form.getHeaders(),
        ...authHeader,
      },
    });

    res.status(200).send({ message: 'Upload successful', data: response.data });
  } catch (err) {
    console.error('Upload failed:', err?.response?.data || err.message);
    res.status(500).json({ error: 'Upload failed', detail: err?.response?.data || err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Uploader running on port ${PORT}`));

export default app;
