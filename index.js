import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import FormData from 'form-data';
import OAuth from 'oauth-1.0a';

const app = express();
app.use(express.json({ limit: '50mb' }));

// Flickr credentials pulled from Vercel env vars
const FLICKR_API_KEY = process.env.FLICKR_API_KEY;
const FLICKR_API_SECRET = process.env.FLICKR_API_SECRET;
const FLICKR_ACCESS_TOKEN = process.env.FLICKR_ACCESS_TOKEN;
const FLICKR_ACCESS_SECRET = process.env.FLICKR_ACCESS_SECRET;

const oauth = new OAuth({
  consumer: { key: FLICKR_API_KEY, secret: FLICKR_API_SECRET },
  signature_method: 'HMAC-SHA1',
  hash_function(base, key) {
    return crypto.createHmac('sha1', key).update(base).digest('base64');
  },
});

app.post('/upload', async (req, res) => {
  const { imageUrl, title = '', description = '' } = req.body;

  if (!imageUrl) {
    return res.status(400).json({ error: 'Missing imageUrl' });
  }

  try {
    const imageResponse = await axios.get(imageUrl, { responseType: 'stream' });

    const form = new FormData();
    form.append('photo', imageResponse.data, { filename: 'image.jpg' });
    form.append('title', title);
    form.append('description', description);
    form.append('is_public', '0'); // Optional

    const url = 'https://up.flickr.com/services/upload/';

    const requestData = {
      url,
      method: 'POST',
    };

    const authHeader = oauth.toHeader(
      oauth.authorize(requestData, {
        key: FLICKR_ACCESS_TOKEN,
        secret: FLICKR_ACCESS_SECRET,
      })
    );

    const response = await axios.post(url, form, {
      headers: {
        ...form.getHeaders(),
        ...authHeader,
      },
    });

    res.status(200).send(response.data);
  } catch (err) {
    console.error('Upload failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Upload failed', detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Uploader running on port ${PORT}`));
