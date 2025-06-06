// index.js
import axios from 'axios';
import FormData from 'form-data';
import express from 'express';
import OAuth from 'oauth-1.0a';
import crypto from 'crypto';

const app = express();
app.use(express.json());

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
  const { dropboxUrl, title = '', description = '', albumTitle = '' } = req.body;

  if (!dropboxUrl || !albumTitle) {
    return res.status(400).json({ error: 'Missing dropboxUrl or albumTitle' });
  }

  try {
    const imageResponse = await axios.get(dropboxUrl, { responseType: 'stream' });

    const form = new FormData();
    form.append('photo', imageResponse.data, { filename: 'upload.jpg' });
    form.append('title', title);
    form.append('description', description);
    form.append('is_public', '0'); // Always private

    const uploadUrl = 'https://up.flickr.com/services/upload/';
    const oauthParams = oauth.authorize({ url: uploadUrl, method: 'POST' }, { key: FLICKR_ACCESS_TOKEN, secret: FLICKR_ACCESS_SECRET });

    const headers = {
      ...form.getHeaders(),
      Authorization: oauth.toHeader(oauthParams).Authorization,
    };

    const uploadResponse = await axios.post(uploadUrl, form, { headers });

    const parsed = await new Promise((resolve, reject) => {
      let data = '';
      uploadResponse.data.on('data', chunk => data += chunk);
      uploadResponse.data.on('end', () => {
        const match = data.match(/<photoid>(.*?)<\/photoid>/);
        if (match) resolve(match[1]);
        else reject(new Error('No photoid returned'));
      });
      uploadResponse.data.on('error', reject);
    });

    return res.status(200).json({ success: true, photoId: parsed });
  } catch (err) {
    console.error('Upload failed:', err);
    return res.status(500).json({ error: 'Upload failed', detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Uploader running on port ${PORT}`));
